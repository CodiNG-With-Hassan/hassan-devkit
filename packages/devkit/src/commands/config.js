import { CONFIG_KEY, loadConfig, requireConfig } from '../core/config.js';
import { loadProfiles } from '../core/compose.js';
import { baseRemote, commitScopes, commitSubjectPattern, imageTag, imageTagInputs, ticketPattern } from '../core/derive.js';
import { listProjects } from '../core/workspace.js';
import { exitOnFailure } from '../util/run.js';

/**
 * Inspection commands. `config:show` is the one place to see declared + derived values
 * together; `commits:show` is what the commit-writer agent and `ci:commit-standards` read
 * so the ticket prefix, types and scopes are never mirrored by hand again.
 */

export function deriveAll(loaded, { compose = true } = {}) {
  const { root, rootName, config } = loaded;
  const projects = listProjects(root);
  const scopes = commitScopes(projects, config.commits.extraScopes);
  const inputs = imageTagInputs(root, projects);
  let profiles = null;
  let composeError = null;
  if (compose) {
    try {
      profiles = loadProfiles(root);
    } catch (e) {
      composeError = e.stderr?.toString().trim() || e.message;
    }
  }
  return {
    root,
    rootName,
    baseRemote: baseRemote(root),
    projects,
    commits: {
      ticketPattern: ticketPattern(config.tracker),
      types: config.commits.types,
      scopes,
      subjectPattern: commitSubjectPattern(config, scopes),
    },
    image: { inputs, tag: inputs.length ? imageTag(root, inputs) : null },
    compose: profiles,
    composeError,
  };
}

function showConfig({ json }) {
  const loaded = requireConfig();
  const derived = deriveAll(loaded);
  if (json) {
    console.log(JSON.stringify({ config: loaded.config, derived }, null, 2));
    return;
  }
  console.log(`root        ${derived.root}`);
  console.log(`root name   ${derived.rootName}`);
  console.log(`base remote ${derived.baseRemote}`);
  console.log(`tracker     ${JSON.stringify(loaded.config.tracker)}`);
  console.log(`\nprojects (${derived.projects.length})`);
  for (const p of derived.projects) console.log(`  ${p.dir.padEnd(28)} ${p.kind.padEnd(4)} ${p.hasEslint ? 'eslint' : ''}`);
  console.log(`\ncommit scopes (${derived.commits.scopes.length})\n  ${derived.commits.scopes.join(', ')}`);
  console.log(`\nimage tag   ${derived.image.tag ?? '(no inputs)'}  from ${derived.image.inputs.length} files`);
  if (derived.compose) {
    console.log(`\ncompose profiles (project "${derived.compose.projectName}")`);
    for (const [profile, services] of Object.entries(derived.compose.profiles)) {
      console.log(`  ${profile.padEnd(10)} ${services.join(', ')}${derived.compose.buildable[profile] ? `  [build: ${derived.compose.buildable[profile].join(', ')}]` : ''}`);
    }
    if (derived.compose.always.length) console.log(`  (always)   ${derived.compose.always.join(', ')}`);
  } else if (derived.composeError) {
    console.log(`\ncompose     could not read the model: ${derived.composeError}`);
  } else {
    console.log('\ncompose     no docker/docker-compose.dev.yml');
  }
  if (loaded.config.worktree) {
    const wt = loaded.config.worktree;
    console.log(`\nworktree    baseDir=${wt.baseDir} maxSlot=${wt.maxSlot} projectName=${wt.projectName}`);
    console.log(`            profiles default=[${wt.profiles.default}] required=[${wt.profiles.required}]`);
    console.log(`            ports ${JSON.stringify(wt.ports)}`);
  } else {
    console.log(`\nworktree    not configured (add "${CONFIG_KEY}.worktree")`);
  }
}

function checkConfig() {
  const loaded = loadConfig();
  if (loaded.errors.length > 0) {
    console.error(`Invalid "${CONFIG_KEY}" block in ${loaded.root}/package.json:`);
    for (const e of loaded.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`"${CONFIG_KEY}" block OK (${Object.keys(loaded.raw).length} section(s) declared)`);
}

function showCommits({ json }) {
  const loaded = requireConfig();
  const { commits } = deriveAll(loaded, { compose: false });
  if (json) {
    console.log(JSON.stringify(commits, null, 2));
    return;
  }
  console.log(`ticket   ${commits.ticketPattern ? `${commits.ticketPattern}  (e.g. "${commits.ticketPattern.replace('[0-9]+', '42')} feat(scope): …")` : 'none (tracker.kind = none)'}`);
  console.log(`types    ${commits.types.join(' | ')}`);
  console.log(`scopes   ${commits.scopes.join(' | ')}`);
  console.log(`pattern  ${commits.subjectPattern}`);
}

export function registerConfig(cli) {
  cli
    .command('config:show', 'Print the resolved hassan-devkit config plus everything derived from the workspace and compose file')
    .option('--json', 'Machine-readable output')
    .action((opts) => exitOnFailure(Promise.resolve().then(() => showConfig({ json: Boolean(opts.json) }))));

  cli
    .command('config:check', 'Validate the hassan-devkit block in package.json (exit 1 on problems)')
    .action(() => exitOnFailure(Promise.resolve().then(checkConfig)));

  cli
    .command('commits:show', 'Print the commit-subject contract: ticket token, types, derived scopes and the regex')
    .option('--json', 'Machine-readable output')
    .action((opts) => exitOnFailure(Promise.resolve().then(() => showCommits({ json: Boolean(opts.json) }))));
}
