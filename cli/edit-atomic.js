/**
 * Atomic file replacement with a one-deep backup.
 *
 * writeAtomic() writes to a sibling temp file and renames it over the target, so a reader
 * never sees a half-written file. The previous content is kept at
 * <root>/.chemx/backups/<relative path>.chemx-backup (latest change only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_SUFFIX = '.chemx-backup';

export const backupPathFor = (absPath, root) => {
  const rel = path.relative(root, absPath);
  return path.join(root, '.chemx', 'backups', `${rel}${BACKUP_SUFFIX}`);
};

const saveBackup = (absPath, root) => {
  const isExisting = fs.existsSync(absPath);
  if (!isExisting) return null;
  const backup = backupPathFor(absPath, root);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(absPath, backup);
  return backup;
};

/**
 * @param {string} absPath Validated absolute target.
 * @param {string} content New content.
 * @param {string} root Workspace root (for the backup location).
 * @returns {{ backup: string|null }}
 */
export const writeAtomic = (absPath, content, root) => {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const backup = saveBackup(absPath, root);
  const mode = backup ? fs.statSync(absPath).mode : undefined;  const tmp = path.join(dir, `.${path.basename(absPath)}.chemx-tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    const hasMode = mode !== undefined;
    if (hasMode) fs.chmodSync(tmp, mode & 0o7777);
    fs.renameSync(tmp, absPath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { backup };
};

/**
 * Removes a file after backing it up.
 *
 * @returns {{ backup: string|null }}
 */
export const removeWithBackup = (absPath, root) => {
  const backup = saveBackup(absPath, root);
  fs.rmSync(absPath, { force: true });
  return { backup };
};

/**
 * Restores a file from its backup, or removes it when it did not exist before.
 *
 * @param {string} absPath Target.
 * @param {string|null} backup Backup path from writeAtomic/removeWithBackup.
 */
export const restoreFromBackup = (absPath, backup) => {
  const hasBackup = Boolean(backup) && fs.existsSync(backup);
  if (hasBackup) {
    fs.copyFileSync(backup, absPath);
    return;
  }
  fs.rmSync(absPath, { force: true });
};
