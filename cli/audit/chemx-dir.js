import fs from 'node:fs';
import path from 'node:path';
import { isSqliteMemoryTarget, isLinkedWorktreeRoot } from '../sqlite-memory.js';
import { hasProjectMarker, isForbiddenRoot, forbiddenRootRefusal } from '../project-markers.js';

// Locates (and creates) the .chemx directory that holds history and the index db.
// The walk prefers an existing ancestor .chemx, but stops at the first project marker (.git,
// package.json, .chemxrc; a linked worktree has a .git file): each package and each checkout keeps
// its own index instead of sharing a parent's. It never climbs into the OS temp dir, its ancestors
// or the filesystem root, and never answers one of them (#2570): a stray /tmp/.chemx is ignored.
const isIndexBoundary = (dir) => isLinkedWorktreeRoot(fs, path, dir) || hasProjectMarker(dir);

// Throws for a forbidden root: callers would otherwise create a db at /tmp or /.
const refuseForbidden = (dir) => {
  const refusal = forbiddenRootRefusal(dir);
  if (refusal) throw new Error(refusal);
  return dir;
};

export const findChemxDir = (startDir = process.cwd()) => {
  const hasCustomRoot = Boolean(process.env.CHEMX_PROJECT_ROOT);
  if (hasCustomRoot) {
    return path.join(refuseForbidden(path.resolve(process.env.CHEMX_PROJECT_ROOT)), '.chemx');
  }

  let current = path.resolve(startDir);
  while (!isForbiddenRoot(current)) {
    const candidate = path.join(current, '.chemx');
    const hasExistingChemx = fs.existsSync(candidate);
    if (hasExistingChemx) {
      return candidate;
    }
    if (isIndexBoundary(current)) return candidate;
    current = path.dirname(current);
  }

  return path.join(refuseForbidden(path.resolve(startDir)), '.chemx');
};

export const ensureChemxDir = (cwd = process.cwd()) => {
  const isMemoryTarget = isSqliteMemoryTarget(cwd);
  if (isMemoryTarget) {
    throw new Error(`ensureChemxDir: "${cwd}" is an in-memory SQLite target, not a directory`);
  }
  const dir = findChemxDir(cwd);
  try {
    const isDirMissing = !fs.existsSync(dir);
    if (isDirMissing) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    return dir;
  }

  // Ensure .chemx is gitignored if git repo exists
  const targetParent = path.dirname(dir);
  const gitDir = path.resolve(targetParent, '.git');
  const hasGit = fs.existsSync(gitDir);
  if (hasGit) {
    const gitignorePath = path.resolve(targetParent, '.gitignore');
    try {
      const hasGitignore = fs.existsSync(gitignorePath);
      let content = hasGitignore ? fs.readFileSync(gitignorePath, 'utf-8') : '';
      const hasChemxEntry = content.includes('.chemx');
      if (!hasChemxEntry) {
        const hasTrailingNewline = content.endsWith('\n') || content.length === 0;
        const trailingNewline = hasTrailingNewline ? '' : '\n';
        fs.appendFileSync(gitignorePath, `${trailingNewline}# Chemical X local telemetry & audit history\n.chemx/\n`, 'utf-8');
      }
    } catch {
      return dir;
    }
  }

  return dir;
};
