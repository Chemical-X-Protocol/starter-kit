export const isPidAlive = (pid) => {
  const isValidPid = typeof pid === 'number' && pid > 0;
  if (!isValidPid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const isNoSuchProcess = err && err.code === 'ESRCH';
    return !isNoSuchProcess;
  }
};

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);

// node:sqlite reports contention as { code: 'ERR_SQLITE_ERROR', errcode: 5, message: 'database is locked' };
// errcode may be an extended code (517 BUSY_SNAPSHOT, 261 BUSY_RECOVERY), so compare the primary byte.
export const isSqliteBusyError = (err) => {
  const hasError = Boolean(err);
  if (!hasError) return false;
  const primaryCode = typeof err.errcode === 'number' ? err.errcode & 0xff : null;
  const isBusyCode = primaryCode === SQLITE_BUSY || primaryCode === SQLITE_LOCKED || BUSY_CODES.has(err.code);
  return isBusyCode || /database is locked|database is busy|SQLITE_BUSY/i.test(String(err.message || ''));
};

const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export const withImmediateTransaction = (db, callback, maxRetries = 5) => {
  const hasDb = Boolean(db);
  const isFunction = typeof callback === 'function';
  const canExecute = hasDb && isFunction;
  if (!canExecute) throw new Error('Database connection and callback required.');

  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE;');
      inTransaction = true;
      const result = callback();
      db.exec('COMMIT;');
      inTransaction = false;
      return result;
    } catch (err) {
      if (inTransaction) {
        try {
          db.exec('ROLLBACK;');
        } catch (rollbackErr) {
          const rollbackNotice = rollbackErr?.message || String(rollbackErr);
          process.stderr.write(`[SWARM] Transaction rollback failed: ${rollbackNotice}\n`);
        }
      }
      const hasRetriesLeft = attempts < maxRetries;
      const canRetry = isSqliteBusyError(err) && hasRetriesLeft;

      if (canRetry) {
        sleepSync(Math.floor(10 * attempts + Math.random() * 20 * attempts));
        continue;
      }
      throw err;
    }
  }
};
