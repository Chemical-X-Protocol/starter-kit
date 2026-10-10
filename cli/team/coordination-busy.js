/**
 * Chemical X Protocol: busy-retry for team writes on the shared coordination db (#4520).
 * SQLite's busy_timeout (5 s) is per statement; a long writer elsewhere (a root verify, a code-index
 * pass) makes a team write fail with "database is locked". This patches a handle IN PLACE (identity
 * is kept, other modules key state on the handle) so exec and prepared run/get/all retry on busy with
 * backoff until a deadline. Guarantee: retries only statements issued outside an open transaction on
 * this handle; a statement inside a transaction still fails on first busy, because replaying it could
 * hide a lost snapshot. Not guaranteed: the wait is bounded (default 30 s), then the busy error is thrown.
 * CHEMX_DB_SLOW_TX_MS (default off): log transactions, and single autocommit run() statements, on a patched
 * handle held longer than that, with the call site, to stderr. Not logged: exec() outside BEGIN/COMMIT and
 * get/all reads. The log names the slow holder's call site, not who blocked a waiter.
 */
import fs from 'node:fs';
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

const UNKNOWN_HOLDER = 'holder unknown';

const dbFilePath = (db) => {
  try {
    const row = db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main');
    return row?.file || '';
  } catch {
    return '';
  }
};

/**
 * Best-effort (Linux /proc only): other processes that hold the db file open, as 'pid N (cmd)'. An open
 * handle is not proof of the writer; every chemx process on this db has one. Returns '' when unavailable.
 */
export const openHolders = (dbPath, selfPid = process.pid) => {
  if (!dbPath) return '';
  const found = [];
  try {
    for (const entry of fs.readdirSync('/proc')) {
      const isPid = /^\d+$/.test(entry);
      const isOther = isPid && Number(entry) !== selfPid;
      const isFull = found.length >= 3;
      if (isFull) break;
      if (!isOther) continue;
      try {
        const isOpen = fs.readdirSync(`/proc/${entry}/fd`).some((fd) => fs.readlinkSync(`/proc/${entry}/fd/${fd}`) === dbPath);
        if (!isOpen) continue;
        const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean).slice(0, 6).join(' ');
        found.push(`pid ${entry} (${cmd.slice(0, 80)})`);
      } catch {
        // chemx-allow: best-effort a process can exit or deny /proc access mid-scan
      }
    }
  } catch {
    return '';
  }
  return found.join(', ');
};

const holderHint = (db) => {
  const holders = openHolders(dbFilePath(db));
  return holders ? `db open in ${holders}; the writer is not identified` : UNKNOWN_HOLDER;
};

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
        process.stderr.write(`coordination db busy (held by: ${holderHint(db)}), retrying for up to ${Math.round(limit / 1000)}s\n`);
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

/** Times one autocommit write (run outside a transaction) and logs it when it exceeds the slow threshold. */
const timedRun = (db, raw, args) => {
  const threshold = slowTxMs();
  const isWatched = Boolean(threshold) && db.isTransaction !== true;
  if (!isWatched) return raw(...args);
  const site = callSite();
  const at = Date.now();
  const out = raw(...args);
  const held = Date.now() - at;
  const isSlow = held > threshold;
  if (isSlow) process.stderr.write(`[chemx-db] autocommit statement elapsed ${held} ms, including any busy-wait behind another writer, so it may be a victim and not the holder (pid ${process.pid}) at ${site}\n`);
  return out;
};

const patchStatement = (db, stmt) => {
  for (const name of STMT_METHODS) {
    const raw = stmt[name].bind(stmt);
    const call = name === 'run' ? (...args) => timedRun(db, raw, args) : raw;
    stmt[name] = (...args) => retryBusy(db, () => call(...args));
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
