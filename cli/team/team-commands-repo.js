/**
 * Chemical X Protocol: repo-aware pieces of `chemx team task` (#2488).
 *   - flags: --repo=<path>, --all-repos, and migrate's --from/--keep-ids/--dry-run/--drop-junk;
 *   - every task-id argument (positional id, --parent, --task, --deps) resolves through task_aliases;
 *   - list defaults to the caller's repo; add and set-target store repo-relative targets.
 */
import path from 'node:path';
import { resolveTaskRef } from './task-ref.js';
import { normalizeTaskTarget } from './task-target.js';

export const REPO_VALUE_FLAGS = ['--repo', '--from', '--keep-ids', '--into', '--source-repo'];

const readFlagValue = (args, name) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  const hasInline = typeof inline === 'string';
  if (hasInline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const next = index === -1 ? undefined : args[index + 1];
  const hasNext = typeof next === 'string' && !next.startsWith('-');
  return hasNext ? next : undefined;
};

export const parseRepoFlags = (args = []) => ({
  allRepos: args.includes('--all-repos'),
  repo: readFlagValue(args, '--repo'),
  from: readFlagValue(args, '--from'),
  keepIds: readFlagValue(args, '--keep-ids'),
  into: readFlagValue(args, '--into'),
  sourceRepo: readFlagValue(args, '--source-repo'),
  dryRun: args.includes('--dry-run'),
  dropJunk: args.includes('--drop-junk')
});

const ID_ARG_ACTIONS = new Set(['show', 'view', 'info', 'comment', 'post', 'vds-slot', 'slot', 'trace', 'claim', 'handoff', 'done', 'complete', 'update', 'set-target', 'target']);

const writeNotices = (notices, isCli) => {
  if (!isCli) return;
  for (const notice of notices) process.stderr.write(`\x1b[33m! ${notice}\x1b[0m\n`);
};

/**
 * Resolves every task-id argument for the caller's repo. Returns new positionals and flags (the
 * inputs are not mutated) plus the ambiguity notices, already printed to stderr for the CLI.
 */
export const resolveTaskIdArgs = (db, context, taskAction, positionals, flags, isCli) => {
  const notices = [];
  const resolveOne = (raw) => {
    const ref = resolveTaskRef(db, raw, { repo: context.repo });
    const hasNotice = Boolean(ref.notice);
    if (hasNotice) notices.push(ref.notice);
    return ref.id ?? raw;
  };
  const nextPositionals = [...positionals];
  const hasIdArg = ID_ARG_ACTIONS.has(taskAction) && Boolean(positionals[1]);
  if (hasIdArg) nextPositionals[1] = String(resolveOne(positionals[1]));
  const nextFlags = { ...flags };
  const hasParentId = Number.isInteger(flags.parent);
  if (hasParentId) nextFlags.parent = resolveOne(flags.parent);
  const hasTaskId = Number.isInteger(flags.task);
  if (hasTaskId) nextFlags.task = resolveOne(flags.task);
  const hasDeps = Array.isArray(flags.dependencies);
  if (hasDeps) nextFlags.dependencies = flags.dependencies.map(resolveOne);
  writeNotices(notices, isCli);
  return { positionals: nextPositionals, flags: nextFlags, notices };
};

const normalizeRepoFlag = (raw) => {
  const cleaned = path.posix.normalize(String(raw).replace(/\\/g, '/')).replace(/\/+$/, '');
  return cleaned === '' ? '.' : cleaned;
};

/** The repo a task list shows: --all-repos (undefined = every repo), --repo=<path>, else the caller's. */
export const resolveListRepo = (flags, context) => {
  const isEveryRepo = Boolean(flags.allRepos);
  if (isEveryRepo) return undefined;
  const hasRepoFlag = typeof flags.repo === 'string' && flags.repo !== '';
  return hasRepoFlag ? normalizeRepoFlag(flags.repo) : context.repo;
};

/**
 * Repo and stored target for a new or re-targeted task: the target's owning repo and its
 * repo-relative path, or the caller's repo when there is no target.
 * @returns {{ repo: string, target_path: string|undefined } | { error: string }}
 */
export const prepareTaskTarget = (context, cwd, target) => {
  const hasTarget = typeof target === 'string' && target !== '';
  if (!hasTarget) return { repo: context.repo, target_path: undefined };
  const split = normalizeTaskTarget({ root: context.root, cwd, target });
  const isRefused = Boolean(split.error);
  return isRefused ? { error: split.error } : { repo: split.repo, target_path: split.path };
};

/** One line naming the db and repo a list or show came from (stderr, human output only). */
export const describeBoardScope = (context, repo) => {
  const scope = repo === undefined ? 'all repos' : `repo "${repo}"`;
  const legacy = context.mode === 'legacy' ? ' (an unmerged package db; `chemx team migrate` moves it to the shared db)' : '';
  return `board ${context.dbPath}${legacy} | showing ${scope}`;
};
