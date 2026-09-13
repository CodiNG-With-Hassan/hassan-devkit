import { requireConfig } from '../core/config.js';
import { cmdCreate, cmdEnv, cmdList, cmdProfiles, cmdPrune, cmdRemove, createContext } from '../core/worktrees.js';
import { exitOnFailure } from '../util/run.js';

// Config loading may throw synchronously; run every action through a promise so the
// failure handler prints the message (not a stack trace) and exits 1.
const withCtx = (fn) => exitOnFailure(Promise.resolve().then(() => fn(createContext(requireConfig()))));

export function registerWorktree(cli) {
  cli
    .command('worktree:create <branch>', 'Create a worktree + isolated dev stack for a ticket branch off <remote>/main (prunes merged ones first)')
    .option('--profiles <list>', 'Compose profiles to start with, comma-separated (default: worktree.profiles.default)')
    .option('--no-up', 'Create the worktree and .env but do not start the stack')
    .action((branch, opts) => withCtx((ctx) => cmdCreate(ctx, branch, { profiles: opts.profiles ? String(opts.profiles).split(',') : undefined, up: opts.up !== false })));

  cli
    .command('worktree:env', 'Refresh this checkout\'s managed .env block (slot, profiles, image tag), build missing images')
    .option('--slot <n>', 'Force a slot (1..maxSlot); refuses one another checkout holds')
    .action((opts) => withCtx((ctx) => cmdEnv(ctx, { slot: opts.slot })));

  cli
    .command('worktree:profiles [action] [...names]', 'list | add <names> | remove <names> — which compose profiles this stack runs')
    .action((action, names) => withCtx((ctx) => cmdProfiles(ctx, action ?? 'list', names ?? [])));

  cli
    .command('worktree:remove <name>', 'Stack down (volumes deleted unless --keep-data) and remove the worktree; the branch is kept')
    .option('--keep-data', 'Keep the database and other volumes')
    .option('--force', 'Remove even with uncommitted changes')
    .action((name, opts) => withCtx((ctx) => cmdRemove(ctx, name, { keepData: Boolean(opts.keepData), force: Boolean(opts.force) })));

  cli
    .command('worktree:prune', 'Remove every worktree whose PR is merged (stack, volumes and branch included)')
    .option('--dry-run', 'Only report what would be removed')
    .action((opts) => withCtx((ctx) => cmdPrune(ctx, { dryRun: Boolean(opts.dryRun) })));

  cli.command('worktree:list', 'List worktrees with their slots, ports, profiles and image tags').action(() => withCtx((ctx) => cmdList(ctx)));
}
