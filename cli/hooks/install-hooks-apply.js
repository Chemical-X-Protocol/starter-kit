// Apply an install plan: back up every file that will change, then write atomically (temp + rename).
// Refused, unchanged and errored actions are never written.

import fs from 'node:fs';
import path from 'node:path';

const WRITABLE = new Set(['create', 'update']);

const timestamp = (now) => new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');

export const backupPathFor = (projectRoot, file, now = Date.now()) => {
  const relative = path.relative(projectRoot, file).replace(/[\\/]/g, '__');
  return path.join(projectRoot, '.chemx', 'backups', `${relative}.${timestamp(now)}`);
};

const writeAtomic = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.chemx-tmp-${process.pid}`;
  fs.writeFileSync(temp, text, { encoding: 'utf-8', mode: mode ?? 0o644 });
  fs.renameSync(temp, file);
};

export const applyInstallPlan = (actions, { projectRoot, dryRun = false, now = Date.now() }) => {
  const results = [];
  for (const action of actions) {
    const isWritable = WRITABLE.has(action.status);
    const shouldWrite = isWritable && !dryRun;
    if (!shouldWrite) { results.push({ ...action, written: false, backup: null }); continue; }
    const hasPrevious = action.before !== null && action.before !== undefined;
    const backup = hasPrevious ? backupPathFor(projectRoot, action.file, now) : null;
    if (backup) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(action.file, backup); }
    writeAtomic(action.file, action.after, action.mode);
    results.push({ ...action, written: true, backup });
  }
  return results;
};
