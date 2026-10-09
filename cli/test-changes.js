// Changed files for `chemx test --changed` / `verify --changed`: everything that differs between
// the working tree (staged, unstaged and untracked) and the base revision, as paths relative
// to `root`. With --base=<rev> the comparison starts at merge-base(<rev>, HEAD), so commits made
// on the branch since <rev> count too.
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const isOk = result.status === 0;
  return { ok: isOk, out: isOk ? result.stdout : '', err: (result.stderr || result.error?.message || '').trim() };
};

const toPosix = (p) => p.split(path.sep).join('/');
const STATUS_LETTERS = { D: 'D', A: 'A' };

const resolveBaseRev = (root, base) => {
  if (!base) return { ok: true, rev: 'HEAD', label: 'HEAD' };
  const mergeBase = git(root, ['merge-base', base, 'HEAD']);
  const hasMergeBase = mergeBase.ok;
  if (hasMergeBase) return { ok: true, rev: mergeBase.out.trim(), label: base };
  const exists = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  return exists.ok ? { ok: true, rev: base, label: base } : { ok: false, error: `unknown base revision "${base}"` };
};

// Returns { ok, base, files: [{ path, status: 'M'|'A'|'D' }], outside: [repo paths outside root] }
// or { ok: false, error }.
export const listChangedFiles = (root, { base = null } = {}) => {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const hasTopLevel = top.ok;
  if (!hasTopLevel) return { ok: false, error: `not a git repository (${top.err || 'git rev-parse failed'})` };
  const baseRev = resolveBaseRev(root, base);
  const hasBaseRev = baseRev.ok;
  if (!hasBaseRev) return { ok: false, error: baseRev.error };
  const diff = git(root, ['diff', '--name-status', '--no-renames', baseRev.rev, '--']);
  const hasDiff = diff.ok;
  if (!hasDiff) return { ok: false, error: `git diff ${baseRev.label} failed: ${diff.err}` };
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--full-name']);
  const topDir = top.out.trim();
  const entries = [
    ...diff.out.split('\n').filter(Boolean).map((line) => {
      const [status, ...rest] = line.split('\t');
      return { repoPath: rest.join('\t'), status: STATUS_LETTERS[status[0]] || 'M' };
    }),
    ...untracked.out.split('\n').filter(Boolean).map((repoPath) => ({ repoPath, status: 'A' }))
  ];
  const files = [];
  const outside = [];
  const seen = new Set();
  for (const entry of entries) {
    const rel = toPosix(path.relative(root, path.join(topDir, entry.repoPath)));
    const isOutside = rel.startsWith('../') || rel === '..' || path.isAbsolute(rel);
    if (isOutside) outside.push(entry.repoPath);
    const isNew = !isOutside && !seen.has(rel);
    if (isNew) files.push({ path: rel, status: entry.status });
    seen.add(rel);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, base: baseRev.label, files, outside, top: topDir };
};
