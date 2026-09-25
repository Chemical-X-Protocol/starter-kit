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
      const isSqliteBusy = err && (err.code === 'SQLITE_BUSY' || String(err.message).includes('busy'));
      const hasRetriesLeft = attempts < maxRetries;
      const canRetry = isSqliteBusy && hasRetriesLeft;

      if (canRetry) {
        const sleepMs = Math.floor(10 + Math.random() * 20);
        const start = Date.now();
        while (Date.now() - start < sleepMs) {}
        continue;
      }
      throw err;
    }
  }
};
