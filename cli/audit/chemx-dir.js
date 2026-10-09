import fs from 'node:fs';
import path from 'node:path';
import { isSqliteMemoryTarget, isLinkedWorktreeRoot } from '../sqlite-memory.js';

// Locates (and creates) the .chemx directory that holds history and the index db.
// The walk prefers an existing ancestor .chemx, but never crosses a linked git worktree root.

export const findChemxDir = (startDir = process.cwd()) => {
  const hasCustomRoot = Boolean(process.env.CHEMX_PROJECT_ROOT);
  if (hasCustomRoot) {
    return path.resolve(process.env.CHEMX_PROJECT_ROOT, '.chemx');
  }

  let current = path.resolve(startDir);
  let gitRoot = null;
  while (true) {
    const candidate = path.join(current, '.chemx');
    const hasExistingChemx = fs.existsSync(candidate);
    if (hasExistingChemx) {
      return candidate;
    }
    const hasGit = !gitRoot && fs.existsSync(path.join(current, '.git'));
    if (hasGit) {
      gitRoot = current;
    }
    const isWorktreeBoundary = isLinkedWorktreeRoot(fs, path, current);
    if (isWorktreeBoundary) break;
    const parent = path.dirname(current);
    const isRootReached = parent === current;
    if (isRootReached) break;
    current = parent;
  }

  const hasDiscoveredGitRoot = Boolean(gitRoot);
  if (hasDiscoveredGitRoot) {
    return path.join(gitRoot, '.chemx');
  }

  return path.resolve(startDir, '.chemx');
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
