/**
 * Lock-aware writes for generators (generate, jig, scaffold).
 * Generators only create files, so applyEdits' lease check never saw them; a team lock on a
 * path that does not exist yet (`chemx team lock acquire src/m-foo`) was ignored. Every path is
 * checked before anything touches disk, so a refusal never leaves a half-written capsule.
 */
import fs from 'node:fs';
import { assertWriteLockClear } from './team/write-lock-guard.js';

/** Throws CHEMX_FILE_LOCKED when another agent leases any of absPaths (directories included). */
export const assertCreatePathsClear = (absPaths, cwd = process.cwd(), agentId) => {
  for (const absPath of absPaths) assertWriteLockClear(absPath, cwd, agentId);
};

/**
 * @param {{ dirs?: string[], files: Array<{ absPath: string, content: string }>, cwd?: string, agentId?: string }} plan
 */
export const writeGeneratedFiles = ({ dirs = [], files, cwd = process.cwd(), agentId }) => {
  // Only paths this call creates are checked: an existing parent directory is not being written.
  const newDirs = dirs.filter((dir) => !fs.existsSync(dir));
  assertCreatePathsClear([...newDirs, ...files.map((f) => f.absPath)], cwd, agentId);
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(file.absPath, file.content, 'utf-8');
};
