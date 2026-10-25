/**
 * Chemical X Protocol: node_modules for a new worktree (#6762, K17).
 * linkNodeModules builds a REAL node_modules directory whose entries are symlinks into the main
 * checkout's, one level for a plain package and two for a scoped one (@scope/name). A single symlink to
 * the whole directory would send a later `npm install` in the worktree straight into the main checkout
 * (the live copy, for the kit itself); with real directories at both levels a new package lands in the
 * worktree only. installCommandFor names the package manager the lockfile points at; runInstall runs it
 * and keeps its output for a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Bookkeeping that describes the main checkout's tree and would lie in a worktree.
const NOT_LINKED = new Set(['.package-lock.json', '.modules.yaml', '.yarn-integrity', '.cache']);
const EXIT_NOT_RUNNABLE = 127;

const isDirectory = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

const linkEntry = (source, link) => {
  const exists = fs.lstatSync(link, { throwIfNoEntry: false }) !== undefined;
  if (exists) return 0;
  fs.symlinkSync(source, link, 'dir');
  return 1;
};

const linkScope = (sourceScope, linkScope) => {
  fs.mkdirSync(linkScope, { recursive: true });
  let linked = 0;
  for (const name of fs.readdirSync(sourceScope)) linked += linkEntry(path.join(sourceScope, name), path.join(linkScope, name));
  return linked;
};

/**
 * @returns {{ linked: number, source: string, missing: boolean }} entries linked; missing = the main checkout has no node_modules
 */
export const linkNodeModules = (mainRoot, worktreeRoot) => {
  const source = path.join(mainRoot, 'node_modules');
  const target = path.join(worktreeRoot, 'node_modules');
  if (!isDirectory(source)) return { linked: 0, source, missing: true };
  fs.mkdirSync(target, { recursive: true });
  let linked = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const isSkipped = NOT_LINKED.has(entry.name);
    const isScope = entry.name.startsWith('@') && isDirectory(path.join(source, entry.name));
    if (isSkipped) continue;
    linked += isScope
      ? linkScope(path.join(source, entry.name), path.join(target, entry.name))
      : linkEntry(path.join(source, entry.name), path.join(target, entry.name));
  }
  return { linked, source, missing: false };
};

const MANAGERS = [
  { lockfile: 'pnpm-lock.yaml', command: 'pnpm', args: ['install'] },
  { lockfile: 'yarn.lock', command: 'yarn', args: ['install'] },
  { lockfile: 'package-lock.json', command: 'npm', args: ['install', '--no-audit', '--no-fund'] }
];

/** @returns {{ command: string, args: string[] }|null} null when the directory has no package.json */
export const installCommandFor = (dir) => {
  const hasPackage = fs.existsSync(path.join(dir, 'package.json'));
  if (!hasPackage) return null;
  const found = MANAGERS.find((manager) => fs.existsSync(path.join(dir, manager.lockfile))) ?? MANAGERS[2];
  return { command: found.command, args: found.args };
};

/** @returns {{ status: number, output: string }} */
export const runInstall = (command, cwd, env = process.env) => {
  const result = spawnSync(command.command, command.args, { cwd, env, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const isMissing = result.error?.code === 'ENOENT';
  if (isMissing) return { status: EXIT_NOT_RUNNABLE, output: `${command.command}: command not found` };
  return { status: result.status ?? 1, output };
};
