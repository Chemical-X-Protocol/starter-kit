/**
 * Chemical X Protocol: `chemx worktree add|remove` (#6762, K17).
 * add: `git worktree add -b <branch> <path> <base>`, then node_modules (--link-modules: a real directory
 * of symlinks into the main checkout's, --install: the lockfile's package manager), then the output: the
 * path first (so `cd "$(chemx worktree add ... | head -1)"` works), the branch and base, the node_modules
 * line, and the reminder that board commands run from the main checkout. remove: removes the worktree and
 * deletes its local branch when it is merged into the default branch (a squash merge counts); refuses an
 * unmerged branch, a dirty worktree, the main checkout and the directory you stand in unless --force.
 * Exit: 0 done, 1 refused or git failed, 2 misused. Git and install details: cli/worktree-git.js,
 * cli/worktree-modules.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveCoordinationRoot } from '../team/coordination-root.js';
import { linkNodeModules, installCommandFor, runInstall } from '../worktree-modules.js';
import { addWorktree, removeWorktree, deleteBranch, branchExists, listWorktrees, defaultBaseRef, resolvesToCommit, shortRef, mergeState } from '../worktree-git.js';

const EXIT_FAILED = 1;
const EXIT_MISUSE = 2;
const USAGE = 'usage: chemx worktree add <path> -b <branch> [--from <ref>] [--link-modules] [--install]\n       chemx worktree remove <path> [--force]\n';
const TAIL_LINES = 20;
const VALUE_FLAGS = { '-b': 'branch', '--branch': 'branch', '--from': 'from', '--as': null };
const SWITCH_FLAGS = { '--link-modules': 'linkModules', '--install': 'install', '--force': 'force' };

const splitFlag = (word) => {
  const isValued = word.startsWith('-') && word.includes('=');
  return isValued ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
};

const emptyParse = () => ({ action: undefined, target: undefined, branch: undefined, from: undefined, linkModules: false, install: false, force: false, error: null });

// Reads one flag at words[at]; returns the index of the last word it used, or an error.
const readFlag = (parsed, words, at) => {
  const [name, inline] = splitFlag(words[at]);
  const isValueFlag = Object.hasOwn(VALUE_FLAGS, name);
  const isSwitch = Object.hasOwn(SWITCH_FLAGS, name);
  if (isSwitch) parsed[SWITCH_FLAGS[name]] = true;
  if (!isValueFlag) return isSwitch ? { used: at } : { error: `unknown flag ${name}` };
  const takesNext = inline === undefined;
  const value = takesNext ? words[at + 1] : inline;
  const isMissingValue = value === undefined;
  if (isMissingValue) return { error: `${name} needs a value` };
  const key = VALUE_FLAGS[name];
  if (key) parsed[key] = value;
  return { used: takesNext ? at + 1 : at };
};

const checkParsed = (parsed, positional) => {
  [parsed.action, parsed.target] = positional;
  const isKnownAction = parsed.action === 'add' || parsed.action === 'remove';
  const hasExtraPath = positional.length > 2;
  const lacksPath = parsed.target === undefined;
  const lacksBranch = parsed.action === 'add' && parsed.branch === undefined;
  if (!isKnownAction) return 'say add or remove';
  if (hasExtraPath) return 'one path only';
  if (lacksPath) return `${parsed.action} needs a path`;
  return lacksBranch ? 'add needs the new branch: -b <branch>' : null;
};

/** @returns {{ action: string|undefined, target: string|undefined, branch: string|undefined, from: string|undefined, linkModules: boolean, install: boolean, force: boolean, error: string|null }} */
export const parseWorktreeArgs = (args = []) => {
  const words = args.map(String);
  const parsed = emptyParse();
  const positional = [];
  for (let at = 0; at < words.length; at += 1) {
    const isFlag = words[at].startsWith('-');
    if (!isFlag) positional.push(words[at]);
    if (!isFlag) continue;
    const read = readFlag(parsed, words, at);
    if (read.error) return { ...parsed, error: read.error };
    at = read.used;
  }
  const error = checkParsed(parsed, positional);
  return { ...parsed, error };
};

const realpathOr = (target) => (fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target));

const isInside = (outer, inner) => {
  const relative = path.relative(outer, inner);
  const isSame = relative === '';
  const isBelow = !relative.startsWith('..') && !path.isAbsolute(relative);
  return isSame || isBelow;
};

const boardReminder = (main) => {
  const board = resolveCoordinationRoot(main).root || main;
  return `board commands (chemx team ...) run from the main checkout ${main} unless you pass --board=${board}\n`;
};

const tail = (text) => text.trim().split('\n').slice(-TAIL_LINES).join('\n');

const failure = (io, message) => {
  io.err(`chemx worktree: ${message}\n`);
  return EXIT_FAILED;
};

const linkLine = (main, target) => {
  const linked = linkNodeModules(main, target);
  return linked.missing ? `no node_modules in ${main} to link\n` : `node_modules linked (${linked.linked} entries) from ${main}\n`;
};

// Runs the install; returns the output line, or the problem text.
const installStep = (target, io, env) => {
  const command = installCommandFor(target);
  if (!command) return { line: 'no package.json in the worktree: nothing to install\n' };
  const started = Date.now();
  const result = io.install(command, target, env);
  const isFailed = result.status !== 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const problem = `${command.command} install failed (exit ${result.status}); the worktree is there, run it by hand. Last lines:\n${tail(result.output)}`;
  return isFailed ? { problem } : { line: `installed with ${command.command} (${seconds}s)\n` };
};

const runAdd = (parsed, cwd, env, io) => {
  const main = listWorktrees(cwd)[0]?.path;
  const base = parsed.from ?? defaultBaseRef(cwd);
  if (!main) return failure(io, 'not inside a git repository');
  if (!base) return failure(io, 'no default branch to start from (origin/HEAD, origin/main, origin/master, main, master); pass --from <ref>');
  const isBaseKnown = resolvesToCommit(cwd, base);
  if (!isBaseKnown) return failure(io, `cannot resolve ${base}; fetch it or pass another --from <ref>`);
  const target = path.resolve(cwd, parsed.target);
  const branchWasThere = branchExists(cwd, parsed.branch);
  const added = addWorktree(cwd, target, parsed.branch, base);
  const isAdded = added.status === 0;
  const leftBranch = !isAdded && !branchWasThere && branchExists(cwd, parsed.branch);
  if (leftBranch) deleteBranch(cwd, parsed.branch);
  if (!isAdded) return failure(io, tail(added.output));
  const linkText = parsed.linkModules ? linkLine(main, target) : '';
  const install = parsed.install ? installStep(target, io, env) : { line: '' };
  io.out(`${target}\nbranch ${parsed.branch} from ${base} (${shortRef(cwd, base)})\n${linkText}${install.line ?? ''}${boardReminder(main)}`);
  return install.problem ? failure(io, install.problem) : 0;
};

const refusalFor = (entry, target, cwd) => {
  if (!entry) return `${target} is not a worktree of this repository`;
  if (entry.isMain) return `${entry.path} is the main checkout, not a linked worktree`;
  const isStandingIn = isInside(entry.path, realpathOr(cwd));
  return isStandingIn ? `you are standing in ${entry.path}; cd out of it first` : null;
};

const runRemove = (parsed, cwd, io) => {
  const target = realpathOr(path.resolve(cwd, parsed.target));
  const entry = listWorktrees(cwd).find((candidate) => realpathOr(candidate.path) === target);
  const refusal = refusalFor(entry, target, cwd);
  if (refusal) return failure(io, refusal);
  const base = defaultBaseRef(cwd);
  const canJudge = Boolean(entry.branch) && Boolean(base);
  const state = canJudge ? mergeState(cwd, entry.branch, base) : 'unmerged';
  const isUnmergedBranch = Boolean(entry.branch) && state === 'unmerged';
  const isRefused = isUnmergedBranch && !parsed.force;
  if (isRefused) return failure(io, `${entry.branch} is not merged into ${base ?? 'any default branch (none found)'} (git fetch first if it was merged lately); nothing was removed. --force removes the worktree and deletes the branch anyway.`);
  const removed = removeWorktree(cwd, entry.path, parsed.force);
  const isRemoved = removed.status === 0;
  if (!isRemoved) return failure(io, tail(removed.output));
  const deleted = entry.branch ? deleteBranch(cwd, entry.branch) : { status: 0, output: '' };
  const isDeleted = deleted.status === 0;
  if (!isDeleted) return failure(io, `removed ${entry.path}, but the branch stays: ${tail(deleted.output)}`);
  const why = state === 'unmerged' ? 'not merged, --force' : `${state} into ${base}`;
  io.out(entry.branch ? `removed ${entry.path}; deleted branch ${entry.branch} (${why})\n` : `removed ${entry.path}\n`);
  return 0;
};

/**
 * @param {string[]} args The words after `worktree`.
 * @param {{ cwd?: string, env?: object, out?: (text: string) => void, err?: (text: string) => void, install?: (command: object, cwd: string, env: object) => { status: number, output: string } }} [options]
 * @returns {Promise<number>} The process exit code.
 */
export const runWorktreeCommand = async (args, options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const io = {
    out: options.out ?? ((text) => process.stdout.write(text)),
    err: options.err ?? ((text) => process.stderr.write(text)),
    install: options.install ?? runInstall
  };
  const parsed = parseWorktreeArgs(args);
  if (parsed.error) {
    io.err(`chemx worktree: ${parsed.error}\n${USAGE}`);
    return EXIT_MISUSE;
  }
  return parsed.action === 'add' ? runAdd(parsed, cwd, env, io) : runRemove(parsed, cwd, io);
};
