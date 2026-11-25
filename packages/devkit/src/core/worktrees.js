import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadProfiles } from './compose.js';
import { COMPOSE_FILE, CONFIG_KEY, ENV_DIST_FILE, ENV_FILE, requireConfig, resolveConfig } from './config.js';
import { expandEnv, imageTag, imageTagInputs, sanitizeName, ticketKeyFromBranch } from './derive.js';
import { managedValues, parseEnv, writeManagedBlock } from './env-block.js';
import { commandExists, run } from './exec.js';
import * as git from './git.js';
import { withLock } from './locks.js';
import * as stack from './stack.js';
import { startTicket, transitionTicket } from './tracker/index.js';
import { listProjects } from './workspace.js';

/**
 * Parallel-development worktrees: one per ticket, each with its own Docker stack (own
 * compose project, host ports and volumes) sharing the dev images with every other
 * checkout on the same dependency manifest. Port of car-rental's `scripts/worktree.sh`.
 *
 * Pure decision functions come first (tested); the orchestration below composes them with
 * git/docker/pnpm side effects. A repo without a compose file gets worktrees without a
 * stack: no `.env`, no slot, no images — just branch + install + tracker.
 */

// ───────────────────────── pure ─────────────────────────

/**
 * Is the worktree feature switched on? The block must exist AND, when the repo has a compose
 * file, name at least one port or a default profile: `init` merges an EMPTY skeleton into
 * every package.json, and that skeleton must stay inert until the project fills it in —
 * otherwise `docker:up` would manage `.env` (and build a second image set) behind the
 * project's existing tooling. A repo without a compose file needs no ports, so `{}` is active.
 */
export function worktreeActive(wt, { hasStack }) {
  if (!wt) return false;
  if (!hasStack) return true;
  return Object.keys(wt.ports).length > 0 || wt.profiles.default.length > 0;
}

/** Compose project of a checkout: slot 0 keeps the configured name; others use the branch. */
export function projectNameFor({ slot, branch, projectName }) {
  if (slot === 0) return projectName;
  const fromBranch = String(branch ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  return fromBranch || `${projectName}-wt${slot}`;
}

/**
 * Validate + order a requested profile list: required profiles first (always present),
 * then the rest in the compose file's order; unknown names throw. With no profiles in
 * the compose file the result is always `[]`.
 */
export function normalizeProfiles(requested, { known, required }) {
  if (known.length === 0) return [];
  const wanted = new Set(
    (Array.isArray(requested) ? requested : String(requested ?? '').split(','))
      .map((p) => p.trim())
      .filter(Boolean),
  );
  for (const p of wanted) {
    if (!known.includes(p)) throw new Error(`unknown profile '${p}' (known: ${known.join(' ')})`);
  }
  for (const r of required) wanted.add(r);
  return [...required.filter((r) => wanted.has(r)), ...known.filter((k) => wanted.has(k) && !required.includes(k))];
}

/** Lowest slot in 1..maxSlot not in `used` (slot 0 is the main checkout). */
export function pickFreeSlot(used, maxSlot) {
  const taken = new Set([0, ...used.map(Number)]);
  for (let s = 1; s <= maxSlot; s++) if (!taken.has(s)) return s;
  throw new Error(`no free slot (all ${maxSlot} in use) — remove a worktree first`);
}

export function validateSlot(value, maxSlot) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || n < 1 || n > maxSlot) {
    throw new Error(`slot must be a number 1-${maxSlot} (0 is the main checkout), got '${value}'`);
  }
  return n;
}

/** Image repository of a `repo[:tag]` reference (registry ports are not tags). */
export function imageRepo(ref) {
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  return colon > slash ? ref.slice(0, colon) : ref;
}

/** `{ service, image }` for every buildable service of the active profiles at `tag`. */
export function imagesFor(compose, profiles, tag) {
  const out = [];
  const seen = new Set();
  const active = new Set(profiles);
  for (const [service, svc] of Object.entries(compose.services)) {
    if (!svc.build || !svc.image) continue;
    const inScope = svc.profiles.length === 0 || svc.profiles.some((p) => active.has(p));
    if (!inScope || seen.has(service)) continue;
    seen.add(service);
    out.push({ service, image: `${imageRepo(svc.image)}:${tag}` });
  }
  return out.sort((a, b) => a.service.localeCompare(b.service));
}

/** Repositories of every buildable service (the dev images this repo owns). */
export function ownedImageRepos(compose) {
  return [...new Set(Object.values(compose.services).filter((s) => s.build && s.image).map((s) => imageRepo(s.image)))].sort();
}

/** node_modules volumes of `project` that belong to another image tag. */
export function staleVolumes(volumes, project, tag) {
  const re = new RegExp(`^${escapeRe(project)}_.*_node_modules_`);
  return volumes.filter((v) => re.test(v) && !v.endsWith(`_node_modules_${tag}`));
}

/** Every node_modules volume of `project` (for a full teardown). */
export function projectVolumes(volumes, project) {
  const re = new RegExp(`^${escapeRe(project)}_.*_node_modules_`);
  return volumes.filter((v) => re.test(v));
}

/** Owned dev images whose tag no checkout references and no container uses. */
export function unreferencedImages(images, { repos, referencedTags, inUse }) {
  const referenced = new Set(['latest', ...referencedTags]);
  const used = new Set(inUse);
  const owned = new Set(repos);
  return images.filter((img) => owned.has(imageRepo(img)) && !referenced.has(img.slice(imageRepo(img).length + 1)) && !used.has(img));
}

/** What `prune` does with a worktree given the `gh pr list` state summary. */
export function pruneDecision(states) {
  if (states === null) return 'error';
  if (states === '') return 'none';
  if (states.includes('OPEN')) return 'open';
  if (states.includes('MERGED')) return 'merged';
  return 'closed';
}

/**
 * A compose call that reaches the containers of every profile, whatever `.env` lists. The
 * shell env wins over --env-file, so `COMPOSE_PROFILES` always gets a value: a .env from
 * before profiles were mandatory must not block its own stop or teardown on the compose guard.
 */
export function everyProfile(args, { known, shellProfiles = process.env.COMPOSE_PROFILES }) {
  return { args: ['--profile', '*', ...args], env: { COMPOSE_PROFILES: shellProfiles || known[0] || 'devkit' } };
}

/**
 * Why `worktree:stop` leaves this checkout alone, or `null` when it has a stack to stop.
 * Only a stack the devkit manages per checkout is stopped: without the managed `.env` the
 * compose project is not this checkout's own, and a stop could hit another checkout's stack.
 */
export function stopSkipReason({ hasStack, managed, hasEnv }) {
  if (!hasStack) return `no ${COMPOSE_FILE}: this repo has no stack`;
  if (!managed) return `"${CONFIG_KEY}.worktree" is not filled in: the stack is not managed per checkout`;
  if (!hasEnv) return `no ${ENV_FILE}: this checkout has no stack of its own`;
  return null;
}

/**
 * The `worktree` block `worktree:create` sets a new worktree up with: the worktree's `own`
 * block, because its commit decides what its stack is (ports, profiles, ready, seeds, env) and
 * the invoking checkout may be behind it. Only where worktrees live and how many slots exist
 * is shared by every checkout, so those two stay the invoking checkout's.
 */
export function ownSettings(invoking, own) {
  return { ...own, baseDir: invoking.baseDir, maxSlot: invoking.maxSlot };
}

/** Dotted keys on which two resolved `worktree` blocks differ, in the order the block lists them. */
export function settingsDrift(a, b) {
  const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const walk = (x, y, path) => {
    if (isRecord(x) && isRecord(y)) return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => walk(x[k], y[k], path ? `${path}.${k}` : k));
    return JSON.stringify(x) === JSON.stringify(y) ? [] : [path];
  };
  return walk(a, b, '');
}

/**
 * The seed step of `worktree:create`: every entry has the `line` to print and the compose
 * `exec` to run after it (`null`: nothing runs). Never empty, so the step is never silent: a
 * stack that came up without its seed data looks the same as a seeded one until a login fails.
 */
export function seedPlan(seeds, { hasStack, up }) {
  if (seeds.scripts.length === 0) return [{ line: 'no seed scripts configured (worktree.seeds.scripts)', exec: null }];
  const why = !hasStack ? `no ${COMPOSE_FILE}, so no stack` : !up ? 'the stack was not started (--no-up)' : null;
  if (why) return [{ line: `not seeding: ${why}; skipped ${seeds.scripts.map((s) => `pnpm ${s}`).join(', ')} (service ${seeds.service})`, exec: null }];
  return seeds.scripts.map((script) => ({ line: `seeding: pnpm ${script} (service ${seeds.service})`, exec: ['exec', seeds.service, 'pnpm', script] }));
}

/** Dockerfiles of the buildable services, relative to `root` (extra image-tag inputs). */
export function dockerfilesFromCompose(compose, root) {
  const files = new Set();
  for (const svc of Object.values(compose?.services ?? {})) {
    if (!svc.build) continue;
    const context = svc.build.context ?? '.';
    const dockerfile = svc.build.dockerfile ?? 'Dockerfile';
    const abs = isAbsolute(dockerfile) ? dockerfile : resolve(isAbsolute(context) ? context : join(root, context), dockerfile);
    const rel = relative(root, abs).split('\\').join('/');
    if (!rel.startsWith('..')) files.add(rel);
  }
  return [...files].sort();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ───────────────────────── context ─────────────────────────

/**
 * Everything the commands need, resolved once. `hasStack` is false when the repo has no
 * compose file; then every docker/env step is skipped.
 */
export function createContext(loaded, { log = console.log, note = (m) => console.error(`note: ${m}`) } = {}) {
  const { root, rootName, config } = loaded;
  const wt = config.worktree;
  if (!wt) throw new Error(`Missing "${CONFIG_KEY}.worktree" in ${join(root, 'package.json')} — add it (or run \`hassan-devkit init\`).`);
  const hasStack = stack.hasComposeFile(root);
  if (!worktreeActive(wt, { hasStack })) {
    throw new Error(`"${CONFIG_KEY}.worktree" is still the empty skeleton — fill in worktree.ports (base host ports) and worktree.profiles.default before using the worktree commands; until then the stack keeps being managed by whatever the project used before.`);
  }
  const main = git.mainRoot(root);
  const baseDir = resolve(main, wt.baseDir);
  let compose = null;
  if (hasStack) {
    compose = loadProfiles(root);
    for (const r of wt.profiles.required) {
      if (!(r in compose.profiles)) throw new Error(`${CONFIG_KEY}.worktree.profiles.required names "${r}", but the compose file has no service with that profile`);
    }
  }
  const known = compose ? Object.keys(compose.profiles) : [];
  return {
    root,
    mainRoot: main,
    baseDir,
    rootName,
    wt,
    tracker: config.tracker,
    hasStack,
    compose,
    known,
    log,
    note,
  };
}

/**
 * The context `worktree:create` sets the new worktree at `dir` up with: its own `package.json`
 * and compose file (see `ownSettings`). The tracker stays the invoking checkout's: it is asked
 * about the branch, not about the stack.
 */
function ownContext(ctx, dir) {
  let loaded = requireConfig({ root: dir });
  // A package.json without a name is named after its directory, here the branch: the defaults
  // derived from the name would differ from the invoking checkout's for no reason.
  if (!loaded.pkg.name) loaded = { ...loaded, rootName: ctx.rootName, config: resolveConfig(loaded.raw, { rootName: ctx.rootName }) };
  const own = createContext(loaded, { log: ctx.log, note: ctx.note });
  return { ...ctx, wt: ownSettings(ctx.wt, own.wt), hasStack: own.hasStack, compose: own.compose, known: own.known, drift: settingsDrift(ctx.wt, own.wt) };
}

// ───────────────────────── .env bookkeeping ─────────────────────────

export function envOf(dir) {
  const file = join(dir, ENV_FILE);
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

/** `[{ dir, env }]` for the main checkout and every worktree under baseDir that has a .env. */
export function allCheckouts(ctx) {
  const dirs = [ctx.mainRoot];
  if (existsSync(ctx.baseDir)) {
    for (const entry of readdirSync(ctx.baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) dirs.push(join(ctx.baseDir, entry.name));
    }
  }
  return dirs.filter((d) => existsSync(join(d, ENV_FILE))).map((d) => ({ dir: d, env: envOf(d) }));
}

export function slotHolders(ctx, slot, exclude) {
  return allCheckouts(ctx)
    .filter(({ dir, env }) => env.DEVKIT_SLOT === String(slot) && (!exclude || resolve(dir) !== resolve(exclude)))
    .map(({ dir }) => basename(dir));
}

export function usedSlots(ctx) {
  return allCheckouts(ctx)
    .filter(({ dir }) => resolve(dir) !== resolve(ctx.mainRoot))
    .map(({ env }) => env.DEVKIT_SLOT)
    .filter((s) => s !== undefined && s !== '');
}

function currentImageTag(ctx, dir) {
  const projects = listProjects(dir);
  const inputs = imageTagInputs(dir, projects, dockerfilesFromCompose(ctx.compose, dir));
  if (inputs.length === 0) throw new Error(`cannot hash the dev image inputs: ${dir} is not a checkout of this repo`);
  return imageTag(dir, inputs);
}

/**
 * Write the managed block of `dir/.env`: own `.env` first (keeps local edits), then the
 * main checkout's, then `.env.dist`; atomic via rename. Returns the managed values.
 */
export function writeEnv(ctx, dir, slot, profiles) {
  const sources = [join(dir, ENV_FILE), join(ctx.mainRoot, ENV_FILE), join(ctx.mainRoot, ENV_DIST_FILE)];
  const src = sources.find((f) => existsSync(f));
  const current = src ? readFileSync(src, 'utf8') : '';
  const branch = git.currentBranch(dir) ?? '';
  const tag = currentImageTag(ctx, dir);
  const values = managedValues({
    slot,
    projectName: projectNameFor({ slot, branch, projectName: ctx.wt.projectName }),
    profiles,
    imageTag: tag,
    branch,
    ports: ctx.wt.ports,
    extraEnv: ctx.wt.env,
  });
  const text = writeManagedBlock(current, values, { slot, profilesHint: ctx.known.length ? ctx.known.join('|') : 'profile' });
  const tmp = join(dir, `${ENV_FILE}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(dir, ENV_FILE));
  const ports = Object.entries(values)
    .filter(([k]) => k.startsWith('DEVKIT_PORT_'))
    .map(([k, v]) => `${k.slice('DEVKIT_PORT_'.length).toLowerCase()}=${v}`)
    .join(' ');
  ctx.log(`wrote ${join(dir, ENV_FILE)} (slot ${slot}, profiles ${profiles.join(',') || '-'}, image tag ${tag}${ports ? `: ${ports}` : ''})`);
  return values;
}

// ───────────────────────── images & volumes ─────────────────────────

function missingImages(ctx, dir) {
  const env = envOf(dir);
  const profiles = (env.COMPOSE_PROFILES ?? '').split(',').filter(Boolean);
  return imagesFor(ctx.compose, profiles, env.DEVKIT_IMAGE_TAG ?? 'latest').filter(({ image }) => !stack.imageExists(image));
}

/** Build the active profiles' images when the tag is new; serialized across checkouts. */
export async function ensureImages(ctx, dir) {
  if (missingImages(ctx, dir).length === 0) return;
  await withLock(
    ctx.baseDir,
    '.image-build.lock',
    'building the shared dev images',
    1800,
    async () => {
      const missing = missingImages(ctx, dir); // someone may have built them while we waited
      if (missing.length === 0) return;
      ctx.log(`building shared dev image(s) ${missing.map((m) => m.image).join(', ')} — every checkout on the same lockfile reuses them`);
      await stack.compose(dir, ['build', ...missing.map((m) => m.service)]);
    },
    { log: ctx.log },
  );
}

/** Drop this project's node_modules volumes that belong to other image tags. */
export function cleanStaleVolumes(ctx, dir) {
  const env = envOf(dir);
  if (!env.COMPOSE_PROJECT_NAME || !env.DEVKIT_IMAGE_TAG) return;
  for (const v of staleVolumes(stack.listVolumes(), env.COMPOSE_PROJECT_NAME, env.DEVKIT_IMAGE_TAG)) {
    if (stack.removeVolume(v)) ctx.log(`removed stale node_modules volume ${v}`);
    else ctx.log(`note: stale volume ${v} is still in use (container on the old image tag) — left alone`);
  }
}

/** Remove owned image tags no checkout's .env references and no container uses. */
export function pruneImages(ctx) {
  if (!ctx.compose) return;
  const referencedTags = allCheckouts(ctx)
    .map(({ env }) => env.DEVKIT_IMAGE_TAG)
    .filter(Boolean);
  const targets = unreferencedImages(stack.listImages(), { repos: ownedImageRepos(ctx.compose), referencedTags, inUse: stack.imagesInUse() });
  for (const img of targets) {
    // Two checkouts pruning at once race for the same tag: whoever finds it gone stays quiet.
    if (!stack.imageExists(img)) continue;
    if (stack.removeImage(img)) ctx.log(`removed unreferenced dev image ${img}`);
    else if (stack.imageExists(img)) ctx.note(`could not remove unreferenced dev image ${img}`);
  }
}

/** `down` across every profile (nothing left behind); `wipe` also removes volumes. */
export async function stackDown(ctx, dir, { wipe }) {
  const call = everyProfile(['down', ...(wipe ? ['-v'] : []), '--remove-orphans'], { known: ctx.known });
  const ok = await stack.compose(dir, call.args, { env: call.env, allowFailure: true });
  if (!ok) ctx.note(`compose down failed in ${dir} — check 'docker ps -a' for leftovers`);
  if (wipe) {
    const project = envOf(dir).COMPOSE_PROJECT_NAME;
    if (project) {
      for (const v of projectVolumes(stack.listVolumes(), project)) {
        if (stack.removeVolume(v)) ctx.log(`removed volume ${v}`);
        else ctx.note(`could not remove volume ${v}`);
      }
    }
  }
}

async function refreshEnv(ctx, dir, slot, profiles) {
  writeEnv(ctx, dir, slot, profiles);
  await ensureImages(ctx, dir);
  cleanStaleVolumes(ctx, dir);
}

function currentProfiles(ctx, dir) {
  const raw = (envOf(dir).COMPOSE_PROFILES ?? '').split(',').filter(Boolean);
  const valid = raw.filter((p) => ctx.known.includes(p)); // a stale name from an old .env is dropped, not fatal
  return normalizeProfiles(valid.length ? valid : ctx.wt.profiles.default, { known: ctx.known, required: ctx.wt.profiles.required });
}

function isMain(ctx, dir) {
  return resolve(dir) === resolve(ctx.mainRoot);
}

// ───────────────────────── commands ─────────────────────────

/** `worktree:env` — refresh this checkout's managed block, images and volumes. */
export async function cmdEnv(ctx, { cwd = process.cwd(), slot: requestedSlot } = {}) {
  if (!ctx.hasStack) {
    ctx.log('no docker/docker-compose.dev.yml — nothing to refresh');
    return;
  }
  const dir = git.toplevel(cwd);
  const env = envOf(dir);
  let slot = requestedSlot !== undefined ? validateSlot(requestedSlot, ctx.wt.maxSlot) : isMain(ctx, dir) ? 0 : env.DEVKIT_SLOT ? Number(env.DEVKIT_SLOT) : null;
  const profiles = currentProfiles(ctx, dir);
  // This runs on every `docker:up`: the one place to catch two checkouts on one slot
  // before their stacks fight over the ports.
  await withLock(
    ctx.baseDir,
    '.slot.lock',
    'assigning a slot',
    120,
    async () => {
      if (slot === null) slot = pickFreeSlot(usedSlots(ctx), ctx.wt.maxSlot);
      const holders = slotHolders(ctx, slot, dir);
      if (holders.length) {
        throw new Error(`slot ${slot} is already used by: ${holders.join(' ')} — two stacks on one slot share host ports; run 'hassan-devkit worktree:env --slot <free slot>' in one of them (see 'hassan-devkit worktree:list')`);
      }
      writeEnv(ctx, dir, slot, profiles);
    },
    { log: ctx.log },
  );
  await ensureImages(ctx, dir);
  cleanStaleVolumes(ctx, dir);
  if (!existsSync(join(dir, 'node_modules')) || (existsSync(join(dir, '.husky')) && !existsSync(join(dir, '.husky/_')))) {
    ctx.note(`${dir} is missing node_modules or .husky/_ — run 'pnpm install' there, otherwise git SILENTLY SKIPS the pre-commit hooks`);
  }
}

/** `worktree:create <branch>` */
export async function cmdCreate(ctx, branch, { profiles: requested, up = true } = {}) {
  if (!branch) throw new Error('usage: hassan-devkit worktree:create <BRANCH> [--profiles a,b] [--no-up]');
  await cmdPrune(ctx, {}); // reclaim merged-PR stacks (and their slots) before spending resources on a new one
  const wtDir = join(ctx.baseDir, branch);
  if (existsSync(wtDir)) throw new Error(`${wtDir} already exists`);
  mkdirSync(ctx.baseDir, { recursive: true });

  // Always start from the freshest main of the canonical remote — never the local main.
  const remote = git.hasRemote(ctx.mainRoot, 'upstream') ? 'upstream' : 'origin';
  const fetched = await run('git', ['-C', ctx.mainRoot, 'fetch', remote, 'main'], { allowFailure: true });
  if (!fetched) throw new Error(`cannot fetch ${remote}/main — refusing to base new work on a possibly stale main`);
  const base = `refs/remotes/${remote}/main`;
  const existing = git.branchExists(ctx.mainRoot, branch);
  if (existing) {
    await git.worktreeAdd(ctx.mainRoot, wtDir, { branch });
    if (!git.isAncestor(ctx.mainRoot, base, branch)) ctx.note(`existing branch ${branch} is behind ${remote}/main — merge it before starting work`);
  } else {
    await git.worktreeAdd(ctx.mainRoot, wtDir, { newBranch: branch, startPoint: base });
  }

  // From here on the worktree's own settings decide: the invoking checkout may be behind (or
  // ahead of) the commit that was just checked out, and its stack settings belong to its commit.
  let own;
  let profiles;
  try {
    own = ownContext(ctx, wtDir);
    profiles = own.hasStack ? normalizeProfiles(requested ?? own.wt.profiles.default, { known: own.known, required: own.wt.profiles.required }) : [];
  } catch (e) {
    // Nothing is spent yet (no slot, no ticket, no install): take the worktree back, so the
    // retry is not refused because the directory already exists.
    const removed = await git.worktreeRemove(ctx.mainRoot, wtDir, { force: true });
    if (removed && !existing) await git.branchDelete(ctx.mainRoot, branch);
    const left = removed ? 'the worktree was removed again' : `the worktree is still at ${wtDir} — remove it with: hassan-devkit worktree:remove ${branch} --force`;
    throw new Error(`${e.message}\n(${branch} is set up from its own package.json and compose file; ${left})`, { cause: e });
  }
  if (own.drift.length) {
    ctx.note(`"${CONFIG_KEY}.worktree" of this checkout differs from the new worktree's in ${own.drift.join(', ')} — the new worktree follows its own package.json, except for baseDir and maxSlot (this checkout's)`);
  }
  if (git.branchExists(ctx.mainRoot, 'main') && !git.isAncestor(ctx.mainRoot, base, 'main')) {
    ctx.note(`local main is behind ${remote}/main — sync it with: git checkout main && git merge --ff-only ${remote}/main`);
  }

  let slot = null;
  if (own.hasStack) {
    await withLock(
      own.baseDir,
      '.slot.lock',
      'assigning a slot',
      120,
      async () => {
        slot = pickFreeSlot(usedSlots(own), own.wt.maxSlot);
        writeEnv(own, wtDir, slot, profiles);
      },
      { log: ctx.log },
    );
  }

  await startTicket({ branch, tracker: ctx.tracker, cwd: wtDir, log: ctx.log, note: ctx.note });

  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: wtDir });
  if (existsSync(join(wtDir, '.husky'))) {
    // husky's shim dir (.husky/_) is per-worktree and git SILENTLY skips every hook when
    // core.hooksPath points at a missing dir — bootstrap it and fail loudly if it didn't take.
    await run('pnpm', ['exec', 'husky'], { cwd: wtDir });
    if (!existsSync(join(wtDir, '.husky/_/pre-commit'))) throw new Error(`husky shims missing in ${wtDir} — git would silently skip all hooks`);
  }

  let values = null;
  if (own.hasStack && up) {
    await ensureImages(own, wtDir);
    await stack.compose(wtDir, ['up', '-d', '--build']);
    values = envOf(wtDir);
    if (own.wt.ready) await stack.waitForUrl(expandEnv(own.wt.ready.url, values), own.wt.ready.timeoutSeconds, { log: ctx.log });
  }
  for (const step of seedPlan(own.wt.seeds, { hasStack: own.hasStack, up })) {
    ctx.log(step.line);
    if (step.exec) await stack.compose(wtDir, step.exec); // a failing seed fails the command
  }

  ctx.log('');
  ctx.log(`Worktree ready: ${wtDir}${slot !== null ? ` (slot ${slot}, profiles: ${profiles.join(',')})` : ''}`);
  if (values) {
    for (const [k, v] of Object.entries(values)) if (k.startsWith('DEVKIT_PORT_')) ctx.log(`  ${k.slice('DEVKIT_PORT_'.length).toLowerCase().padEnd(14)} localhost:${v}`);
    const optional = own.known.filter((p) => !own.wt.profiles.required.includes(p) && !profiles.includes(p));
    if (optional.length) ctx.log(`  add a profile with: hassan-devkit worktree:profiles add ${optional.join('|')}`);
  }
  return { dir: wtDir, slot, profiles };
}

/** `worktree:profiles list|add|remove [names…]` */
export async function cmdProfiles(ctx, action = 'list', names = [], { cwd = process.cwd() } = {}) {
  if (!ctx.hasStack) throw new Error('no docker/docker-compose.dev.yml — this repo has no stack profiles');
  const dir = git.toplevel(cwd);
  const env = envOf(dir);
  const slot = isMain(ctx, dir) ? 0 : env.DEVKIT_SLOT ? Number(env.DEVKIT_SLOT) : null;
  if (slot === null) throw new Error(`no managed .env in ${dir} — run 'hassan-devkit worktree:env' first`);
  const current = currentProfiles(ctx, dir);
  switch (action) {
    case 'list':
      ctx.log(`active:    ${current.join(',') || '-'}`);
      ctx.log(`available: ${ctx.known.join(' ')}${ctx.wt.profiles.required.length ? ` (${ctx.wt.profiles.required.join(', ')} mandatory)` : ''}`);
      return current;
    case 'add': {
      if (names.length === 0) throw new Error(`usage: hassan-devkit worktree:profiles add <${ctx.known.join('|')}> [...]`);
      const next = normalizeProfiles([...current, ...names], { known: ctx.known, required: ctx.wt.profiles.required });
      await refreshEnv(ctx, dir, slot, next);
      // `up -d` is idempotent for running services; only the new profile's containers appear.
      await stack.compose(dir, ['up', '-d']);
      return next;
    }
    case 'remove': {
      if (names.length === 0) throw new Error(`usage: hassan-devkit worktree:profiles remove <${ctx.known.join('|')}> [...]`);
      for (const p of names) {
        if (ctx.wt.profiles.required.includes(p)) throw new Error(`the ${p} profile is mandatory and cannot be removed`);
        if (!ctx.known.includes(p)) throw new Error(`unknown profile '${p}' (known: ${ctx.known.join(' ')})`);
      }
      const next = normalizeProfiles(current.filter((p) => !names.includes(p)), { known: ctx.known, required: ctx.wt.profiles.required });
      writeEnv(ctx, dir, slot, next);
      for (const p of names) {
        // The profile is no longer active, so a plain up/down would not see its containers.
        await stack.compose(dir, ['--profile', p, 'rm', '-sf', ...ctx.compose.profiles[p]], { allowFailure: true });
      }
      return next;
    }
    default:
      throw new Error('usage: hassan-devkit worktree:profiles list|add|remove [name ...]');
  }
}

/**
 * `worktree:stop` — stop this checkout's stack across every profile. The containers stay, with
 * their volumes, the slot and `.env`, so `docker:up` starts the same stack again. Takes the
 * loaded config, not a context: where there is nothing to stop it says why and succeeds, also
 * in a repo whose `worktree` block is missing. A stop that fails throws.
 */
export async function cmdStop(loaded, { log = console.log } = {}) {
  const dir = loaded.root;
  const hasStack = stack.hasComposeFile(dir);
  const skip = stopSkipReason({
    hasStack,
    managed: hasStack && worktreeActive(loaded.config.worktree, { hasStack }),
    hasEnv: existsSync(join(dir, ENV_FILE)),
  });
  if (skip) {
    log(`${skip} — nothing stopped`);
    return;
  }
  const call = everyProfile(['stop'], { known: createContext(loaded, { log }).known });
  await stack.compose(dir, call.args, { env: call.env });
  log(`stopped the stack of ${dir} (containers and data kept) — start it again with: pnpm docker:dev:up`);
}

/** `worktree:remove <name>` — stack down (volumes gone unless --keep-data), worktree removed, branch kept. */
export async function cmdRemove(ctx, name, { keepData = false, force = false } = {}) {
  if (!name) throw new Error('usage: hassan-devkit worktree:remove <BRANCH> [--keep-data] [--force]');
  const dir = existsSync(name) && existsSync(join(name, '.git')) ? resolve(name) : join(ctx.baseDir, name);
  if (!existsSync(dir)) throw new Error(`no worktree at ${dir}`);
  if (ctx.hasStack && existsSync(join(dir, ENV_FILE))) await stackDown(ctx, dir, { wipe: !keepData });
  const removed = await git.worktreeRemove(ctx.mainRoot, dir, { force });
  if (!removed) throw new Error(`git worktree remove failed for ${dir} — stray changes? re-run with --force`);
  pruneImages(ctx);
  ctx.log(`removed ${dir} (branch kept — delete it with: git branch -D ${basename(dir)})`);
}

/**
 * `worktree:prune` — remove every worktree whose PR is merged (GitHub is the oracle) and
 * report the merge to the tracker for the ticket of each one it removed.
 */
export async function cmdPrune(ctx, { dryRun = false } = {}) {
  if (!commandExists('gh')) {
    ctx.note('gh not installed — cannot check PR states, skipping prune');
    return [];
  }
  const removed = [];
  if (!existsSync(ctx.baseDir)) return removed;
  for (const entry of readdirSync(ctx.baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(ctx.baseDir, entry.name);
    if (!existsSync(join(dir, '.git'))) continue;
    const branch = git.currentBranch(dir);
    if (!branch) {
      ctx.note(`prune: ${entry.name}: no branch checked out — keeping`);
      continue;
    }
    // PRs live on the base repo (fork model): ask upstream, not origin. `pr view` cannot
    // see fork-owned heads, so filter `pr list` by head ref name instead.
    const baseRepo = git.remoteUrl(dir, 'upstream') ?? git.remoteUrl(dir, 'origin');
    if (!baseRepo) {
      ctx.note(`prune: ${entry.name}: no git remote — keeping`);
      continue;
    }
    const states = ghPrStates(baseRepo, branch);
    const decision = pruneDecision(states);
    if (decision !== 'merged') {
      const why = { error: 'gh could not answer', none: 'no PR', open: 'PR open', closed: 'PR closed without merge' }[decision];
      ctx.log(`prune: ${entry.name}: ${why} — keeping`);
      continue;
    }
    if (dryRun) {
      ctx.log(`prune: ${entry.name}: PR merged — would remove worktree, containers, volumes, and branch`);
      removed.push(entry.name);
      continue;
    }
    ctx.log(`prune: ${entry.name}: PR merged — removing worktree, containers, volumes, and branch`);
    const key = ticketKeyFromBranch(branch, ctx.tracker);
    if (ctx.hasStack && existsSync(join(dir, ENV_FILE))) await stackDown(ctx, dir, { wipe: true });
    if (await git.worktreeRemove(ctx.mainRoot, dir)) {
      await git.branchDelete(ctx.mainRoot, branch);
      removed.push(entry.name);
      await transitionTicket({ key, event: 'merged', tracker: ctx.tracker, log: ctx.log, note: ctx.note });
    } else {
      // The ticket only moves with the worktree prune removes; this one is left to the developer.
      const move = key && ctx.tracker.transitions?.merged ? ` && hassan-devkit tracker:transition ${key} merged` : '';
      ctx.note(`prune: ${entry.name} has stray changes — check them, then run: hassan-devkit worktree:remove ${entry.name} --force && git branch -D ${branch}${move}`);
    }
  }
  if (!dryRun) pruneImages(ctx);
  return removed;
}

function ghPrStates(repoUrl, branch) {
  const { capture } = stackExecShim;
  return capture('gh', ['pr', 'list', '--repo', repoUrl, '--head', branch, '--state', 'all', '--json', 'state', '--jq', '[.[].state] | unique | join(",")'], { allowFailure: true });
}

/** `worktree:list` */
export function cmdList(ctx) {
  for (const w of git.listWorktrees(ctx.mainRoot)) ctx.log(`${w.path}  ${w.head ? w.head.slice(0, 8) : ''} [${w.branch ?? 'detached'}]`);
  const checkouts = allCheckouts(ctx).filter(({ env }) => env.DEVKIT_SLOT !== undefined && env.DEVKIT_SLOT !== '');
  for (const { dir, env } of checkouts) {
    const ports = Object.entries(env)
      .filter(([k]) => k.startsWith('DEVKIT_PORT_'))
      .map(([k, v]) => `${k.slice('DEVKIT_PORT_'.length).toLowerCase()} :${v}`)
      .join(', ');
    ctx.log(`  ${basename(dir)}: slot ${env.DEVKIT_SLOT} (${ports}), profiles [${env.COMPOSE_PROFILES ?? ''}], image tag [${env.DEVKIT_IMAGE_TAG ?? ''}]`);
  }
  const bySlot = new Map();
  for (const { dir, env } of checkouts) bySlot.set(env.DEVKIT_SLOT, [...(bySlot.get(env.DEVKIT_SLOT) ?? []), basename(dir)]);
  for (const [slot, names] of bySlot) {
    if (names.length > 1) ctx.note(`slot ${slot} is used by ${names.join(' ')} — run 'hassan-devkit worktree:env --slot <free slot>' in all but one of them`);
  }
}

// `capture` is imported lazily through this shim so the pure functions above can be unit
// tested without touching child_process at module load.
import { capture as captureImpl } from './exec.js';
const stackExecShim = { capture: captureImpl };

export { sanitizeName, dirname };
