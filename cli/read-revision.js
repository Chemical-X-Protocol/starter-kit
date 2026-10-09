/**
 * `chemx read <rev>:<path>[:N-M]` and MCP read { path, rev }: file content at a git revision,
 * through the same outline/symbol/range modes and N| numbering as a working-tree read.
 *
 * `a:b` stays a line range (or a plain path) whenever `a` exists as a file; it is a revision
 * only when `a` is not a file and git resolves it to a commit. Revisions that start with '-'
 * or hold shell/pathspec characters are refused, and the path goes through resolveSafePath,
 * so a read at a revision never reaches outside the project root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSafePath } from './path-scope.js';

const SAFE_REVISION = /^[\w./~^@{}+-]+$/;
const LINE_SUFFIX = /^(.*?):(\d+)(?:[-:](\d+))?$/;

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

export const isSafeRevision = (rev) => typeof rev === 'string' && rev.length > 0 && !rev.startsWith('-') && SAFE_REVISION.test(rev);

export const isCommitish = (rev, cwd) => isSafeRevision(rev) && git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).status === 0;

/** "HEAD~1:src/a.ts" -> { rev, spec: 'src/a.ts' } when the left side is a revision, not a file. */
export const splitRevSpec = (spec, cwd) => {
  const idx = typeof spec === 'string' ? spec.indexOf(':') : -1;
  if (idx <= 0) return null;
  const rev = spec.slice(0, idx);
  const rest = spec.slice(idx + 1);
  const isWorkingFile = fs.existsSync(path.resolve(cwd, rev));
  const isRevision = rest.length > 0 && !isWorkingFile && isCommitish(rev, cwd);
  return isRevision ? { rev, spec: rest } : null;
};

/**
 * @returns {string} The file's content at `rev`.
 */
export const readAtRevision = (rev, filePath, cwd) => {
  if (!isSafeRevision(rev)) throw new Error(`Refusing revision ${JSON.stringify(rev)}: use a ref, sha, or ref~N / ref^ form.`);
  const rel = path.relative(cwd, resolveSafePath(filePath, cwd)).split(path.sep).join('/');
  const res = git(cwd, ['show', `${rev}:./${rel}`]);
  if (res.status !== 0) {
    const detail = (res.stderr || '').trim().split('\n')[0];
    throw new Error(`Cannot read ${rel} at revision ${rev}${detail ? `: ${detail}` : ''}`);
  }
  return res.stdout;
};

/**
 * Resolves a revision read for readTokenOptimized, or null for a working-tree read.
 *
 * @returns {null | { rev: string, path: string, content: string, startLine?: number, endLine?: number }}
 */
export const resolveRevisionRead = (targetPath, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const split = options.rev ? { rev: options.rev, spec: targetPath } : splitRevSpec(targetPath, cwd);
  if (!split) return null;
  const lines = LINE_SUFFIX.exec(split.spec);
  const filePath = lines ? lines[1] : split.spec;
  const content = readAtRevision(split.rev, filePath, cwd);
  return {
    rev: split.rev,
    path: filePath,
    content,
    startLine: options.startLine ?? (lines ? Number(lines[2]) : undefined),
    endLine: options.endLine ?? (lines && lines[3] ? Number(lines[3]) : undefined)
  };
};
