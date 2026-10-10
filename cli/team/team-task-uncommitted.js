/**
 * Chemical X Protocol: `task done` refuses while the task's target has uncommitted changes.
 * Guarantees only: when the target sits in a git work tree and `git status` lists it as
 * modified or untracked, the completion is refused and the path is named. Outside a git
 * repo, or if git cannot run, nothing is checked. --force skips the check.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';

const gitStatusLines = (cwd, paths) => {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

export const uncommittedTargets = (cwd, task) => {
  const hasTarget = Boolean(task?.target_path);
  if (!hasTarget) return [];
  const target = path.isAbsolute(task.target_path) ? task.target_path : path.resolve(cwd, task.target_path);
  return gitStatusLines(path.dirname(target), [path.basename(target)]).map((line) => line.slice(3));
};

export const buildUncommittedRefusal = (taskId, files) => ({
  refused: true,
  uncommitted: true,
  taskId: Number(taskId),
  files,
  message: `Refusing to complete task #${taskId}: uncommitted changes in ${files.join(', ')}. Commit them first (chemx commit <files> -m "..." --release), or pass --force to complete anyway. Only the target is checked.`
});
