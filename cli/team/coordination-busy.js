/**
 * Chemical X Protocol: busy-retry for team writes on the shared coordination db (#4520).
 * SQLite's busy_timeout (5 s) is per statement; a long writer elsewhere (a root verify, a code-index
 * pass) makes a team write fail with "database is locked". This patches a handle IN PLACE (identity
 * is kept, other modules key state on the handle) so exec and prepared run/get/all retry on busy with
 * backoff until a deadline. Guarantee: retries only statements issued outside an open transaction on
 * this handle; a statement inside a transaction still fails on first busy, because replaying it could
 * hide a lost snapshot. Not guaranteed: the wait is bounded (default 30 s), then the busy error is thrown.
 * CHEMX_DB_SLOW_TX_MS (default off): log transactions on a patched handle held longer than that, with
 * the call site, to stderr.
 */
import { isSqliteBusyError } from './team-db-transaction.js';

const PATCHED = Symbol.for('chemx.coordination.busyRetry');
const STMT_METHODS = ['run', 'get', 'all'];
const DEFAULT_DEADLINE_MS = 30_000;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const deadlineMs = () => {
  const n = Number(process.env.CHEMX_DB_BUSY_DEADLINE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEADLINE_MS;
};

const slowTxMs = () => {
  const n = Number(process.env.CHEMX_DB_SLOW_TX_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const callSite = () => {
  const frames = String(new Error().stack || '').split('\n').slice(2);
  const outside = frames.find((line) => !line.includes('coordination-busy.js'));
  return (outside || 'unknown call site').trim();
};

const HOLDER_HINT = 'holder unknown: another chemx process or tool holds the write lock';

/** Runs fn, retrying on SQLITE_BUSY with jittered backoff until the deadline. */
export const retryBusy = (db, fn) => {
  const isInTransaction = db.isTransaction === true;
  if (isInTransaction) return fn();
  const start = Date.now();
  const limit = deadlineMs();
  let attempt = 0;
  let isNoticed = false;
  for (;;) {
    try {
      return fn();
    } catch (err) {
      const elapsed = Date.now() - start;
      const isGiveUp = !isSqliteBusyError(err) || elapsed >= limit;
      if (isGiveUp) throw err;
      if (!isNoticed) {
        isNoticed = true;
        process.stderr.write(`coordination db busy (${HOLDER_HINT}), retrying for up to ${Math.round(limit / 1000)}s\n`);
      }
      attempt++;
      const wait = Math.min(1000, 25 * 2 ** Math.min(attempt, 6)) + Math.floor(Math.random() * 25);
      sleepSync(Math.min(wait, Math.max(1, limit - elapsed)));
    }
  }
};

const watchTransactions = (rawExec) => {
  let began = null;
  return (sql) => {
    const threshold = slowTxMs();
    const text = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
    const isBegin = Boolean(threshold) && /^BEGIN\b/.test(text);
    if (isBegin) began = { at: Date.now(), site: callSite() };
    const out = rawExec(sql);
    const isEnd = Boolean(threshold && began) && /^(COMMIT|END|ROLLBACK)\b/.test(text);
    if (isEnd) {
      const held = Date.now() - began.at;
      const isSlow = held > threshold;
      if (isSlow) process.stderr.write(`[chemx-db] write transaction held ${held} ms (pid ${process.pid}) at ${began.site}\n`);
      began = null;
    }
    return out;
  };
};

const patchStatement = (db, stmt) => {
  for (const name of STMT_METHODS) {
    const raw = stmt[name].bind(stmt);
    stmt[name] = (...args) => retryBusy(db, () => raw(...args));
  }
  return stmt;
};

/** Patches db in place (once) and returns it. */
export const withBusyRetry = (db) => {
  const isPatchable = Boolean(db) && !db[PATCHED];
  if (!isPatchable) return db;
  const rawExec = db.exec.bind(db);
  const rawPrepare = db.prepare.bind(db);
  const watched = watchTransactions(rawExec);
  db.exec = (sql) => retryBusy(db, () => watched(sql));
  db.prepare = (sql) => patchStatement(db, rawPrepare(sql));
  Object.defineProperty(db, PATCHED, { value: true });
  return db;
};
