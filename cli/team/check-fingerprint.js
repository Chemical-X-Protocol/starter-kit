/**
 * The working-tree fingerprint the check queue keys its cache, its join of a running job and its stale
 * flag on. Two depths, because the cost differs by an order of magnitude in a monorepo of submodules
 * (measured in the elysium root: shallow about 80 to 125 ms on a busy shared tree, deep about 1.5 s):
 *  - shallow (the enqueue path): HEAD plus every changed or untracked path of the repo that holds cwd, with
 *    its size and mtime, plus the commit each flagged submodule points at. Two cheap git calls.
 *  - deep (the drain worker, and the verification of a cache or join candidate): shallow plus the same
 *    state for every submodule's own working tree, recursively, so an edit inside a dirty submodule shows.
 * Paths are resolved against the repo toplevel (git status prints them relative to it, whatever cwd is).
 * '' means git could not say, and callers treat that as "never cache, never join".
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GITLINK_MODE = '160000';
const MAX_SUBMODULE_DEPTH = 4;
const STATUS_ARGS = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty'];

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

const hasOrigin = (code) => /[RC]/.test(code);

/** Parses `git status --porcelain=v1 -z`: a rename or copy record is followed by its origin path as a record of its own. */
export const parseStatusZ = (text) => {
  const records = text.split('\0');
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const isEntry = record.length >= 4;
    if (!isEntry) continue;
    const code = record.slice(0, 2);
    entries.push({ code, path: record.slice(3) });
    if (!hasOrigin(code)) continue;
    index += 1;
    const origin = records[index];
    if (origin) entries.push({ code: 'origin', path: origin });
  }
  return entries;
};

const headOf = (dir) => {
  try {
    return git(dir, ['rev-parse', 'HEAD']).trim();
  } catch {
    return 'no-head';
  }
};

const stampOf = (top, { code, path }) => {
  try {
    const stats = statSync(join(top, path));
    // A directory here is a submodule whose commit moved: its own HEAD says which commit.
    if (stats.isDirectory()) return `${code}:${path}:dir:${headOf(join(top, path))}`;
    return `${code}:${path}:${stats.size}:${Math.floor(stats.mtimeMs)}`;
  } catch {
    return `${code}:${path}:gone`;
  }
};

const gitlinkPaths = (top) => git(top, ['ls-files', '--stage', '-z']).split('\0').filter((line) => line.startsWith(GITLINK_MODE)).map((line) => line.slice(line.indexOf('\t') + 1));

const changesOf = (top) => parseStatusZ(git(top, STATUS_ARGS)).sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)).map((entry) => stampOf(top, entry));

// One git call per submodule: its HEAD is already pinned by the parent (an unflagged submodule sits at the
// index's gitlink, a moved one is stamped by stampOf), so only its own changed and untracked files are read.
// A directory with no .git entry is an uninitialized submodule; git run there would report the parent repo.
const submodulesOf = (top, depth) => {
  const parts = [];
  const isNested = depth > 0;
  const hasSubmodules = !isNested || existsSync(join(top, '.gitmodules'));
  const isTooDeep = depth >= MAX_SUBMODULE_DEPTH;
  const hasNothingToVisit = !hasSubmodules || isTooDeep;
  if (hasNothingToVisit) return parts;
  for (const path of gitlinkPaths(top).sort()) {
    const dir = join(top, path);
    const isInitialized = existsSync(join(dir, '.git'));
    if (!isInitialized) {
      parts.push(`sub:${path}:uninitialized`);
      continue;
    }
    try {
      parts.push(`sub:${path}`, ...changesOf(dir), ...submodulesOf(dir, depth + 1));
    } catch {
      parts.push(`sub:${path}:unreadable`);
    }
  }
  return parts;
};

const stateOf = (cwd, isDeep) => {
  const [top, head] = git(cwd, ['rev-parse', '--show-toplevel', 'HEAD']).trim().split('\n');
  return [head, ...changesOf(top), ...(isDeep ? submodulesOf(top, 0) : [])];
};

/** A hash of the working tree's state; see the file header for what shallow and deep cover. '' when git cannot say. */
export const treeFingerprint = (cwd, { deep = false } = {}) => {
  try {
    return createHash('sha1').update(stateOf(cwd, deep).join('\n')).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
};
