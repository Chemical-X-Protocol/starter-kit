/**
 * Chemical X Protocol: per-agent scratch space (#6762, K17).
 * Agents that share one scratchpad overwrite each other's one-off scripts. `chemx scratch` gives each
 * handle its own directory, `<project>/.chemx/scratch/<handle>/`, next to the index it belongs to (a
 * linked worktree has its own). The directory is made on demand and kept out of git: ensureChemxDir
 * already writes `.chemx/` into a fresh repo's .gitignore, and when a .gitignore lists only part of
 * `.chemx` (say `.chemx/index.db`) a `.chemx/scratch/` line is added, judged by `git check-ignore`
 * itself, so a parent or global ignore rule counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureChemxDir } from './audit/chemx-dir.js';

const SHARED_NAME = '_shared';
const IGNORE_LINE = '.chemx/scratch/';

/** `@sonnet-k17` -> `sonnet-k17`. Anything outside [A-Za-z0-9._-] becomes a dash; no usable handle is `_shared`. */
export const scratchHandleName = (handle) => {
  const bare = String(handle ?? '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '-');
  const isDotsOnly = /^\.*$/.test(bare);
  return isDotsOnly ? SHARED_NAME : bare;
};

const usageError = (message) => Object.assign(new Error(message), { isUsage: true });

/** The path of `name` inside the handle's directory; a name that would leave it throws. */
export const scratchPathFor = (dir, name) => {
  const hasName = typeof name === 'string' && name.trim() !== '';
  if (!hasName) throw usageError('a file name is needed');
  const target = path.resolve(dir, name);
  const relative = path.relative(dir, target);
  const isInside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!isInside) throw usageError(`"${name}" must name a file inside ${dir}`);
  return target;
};

// 0 = ignored, 1 = not ignored, anything else = git could not say (no repo, no git).
const gitIgnoreStatus = (cwd, target) => spawnSync('git', ['check-ignore', '-q', target], { cwd, stdio: 'ignore' }).status;

const ensureScratchIgnored = (projectDir, dir) => {
  const isUnignored = gitIgnoreStatus(projectDir, dir) === 1;
  if (!isUnignored) return false;
  const file = path.join(projectDir, '.gitignore');
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lead = content === '' || content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${lead}# Chemical X per-agent scratch space\n${IGNORE_LINE}\n`, 'utf8');
  return true;
};

/**
 * Creates `<project>/.chemx/scratch/<handle>/` and makes sure git ignores it.
 * @returns {{ dir: string, ignoreAdded: boolean }}
 */
export const ensureScratchDir = (cwd, handle) => {
  const chemxDir = ensureChemxDir(cwd);
  const dir = path.join(chemxDir, 'scratch', scratchHandleName(handle));
  fs.mkdirSync(dir, { recursive: true });
  return { dir, ignoreAdded: ensureScratchIgnored(path.dirname(chemxDir), dir) };
};
