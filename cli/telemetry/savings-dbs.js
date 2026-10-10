/**
 * Chemical X Protocol: which call-ledger databases `chemx report savings` reads (#5888).
 * The ledger row is written to the nearest .chemx/index.db above the caller's cwd, so a run working in
 * a sub-package (apps/youmeos) logs to that package's db, not to the root one. The report therefore
 * reads the db it was handed plus every other package db found under the coordination root, and names
 * each one. Guaranteed: the dbs listed were opened and read. Not guaranteed: a db outside the search
 * (deeper than MAX_DEPTH, or under a skipped directory) is not found and its calls are not counted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRunCalls } from './savings-tooling.js';

export const MAX_DEPTH = 4;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.cache']);
const LEDGER_FILE = path.join('.chemx', 'index.db');

const realOf = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

const isWalkable = (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name);

const subdirsOf = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(isWalkable).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};

const hasLedgerFile = (dir) => fs.existsSync(path.join(dir, LEDGER_FILE));

/** The highest ancestor of cwd (cwd included) that holds .chemx/index.db, or cwd when none does. */
export const ledgerRootOf = (cwd) => {
  const chain = [];
  for (let dir = path.resolve(cwd); !chain.includes(dir); dir = path.dirname(dir)) chain.push(dir);
  const holders = chain.filter(hasLedgerFile);
  return holders.length > 0 ? holders[holders.length - 1] : path.resolve(cwd);
};

/** Every .chemx/index.db at root or at most MAX_DEPTH directories below it, as absolute paths. */
export const findLedgerDbs = (root) => {
  const walk = (dir, depth) => {
    const own = hasLedgerFile(dir) ? [path.join(dir, LEDGER_FILE)] : [];
    const canDescend = depth < MAX_DEPTH;
    return canDescend ? [...own, ...subdirsOf(dir).flatMap((sub) => walk(sub, depth + 1))] : own;
  };
  return walk(path.resolve(root), 0);
};

const locationOf = (db) => {
  try {
    return db.location();
  } catch {
    return null;
  }
};

const openReadOnly = (file) => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return new DatabaseSync(file, { readOnly: true });
};

const tryOpen = (file, root) => {
  try {
    return { label: path.relative(root, file), db: openReadOnly(file), isReadOnly: true };
  } catch {
    return { label: path.relative(root, file), db: null, isReadOnly: true };
  }
};

/** Open the other package dbs read-only. A db that cannot be opened is listed in `failed`, not hidden. */
export const openExtraLedgerDbs = (db, cwd) => {
  const root = ledgerRootOf(cwd);
  const own = locationOf(db);
  const ownReal = own ? realOf(own) : null;
  const opened = findLedgerDbs(root).filter((file) => realOf(file) !== ownReal).map((file) => tryOpen(file, root));
  return {
    root,
    own: own ? path.relative(root, own) : 'current db',
    extras: opened.filter((o) => o.db),
    failed: opened.filter((o) => !o.db).map((o) => o.label)
  };
};

const hasLedger = (db) => Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'tool_calls'").get());

const earlier = (a, b) => (Number.isFinite(b) && (a === null || b < a) ? b : a);

/**
 * Collect the run window's calls from several dbs. Each source is { label, db, isReadOnly }. A read-only
 * source without a tool_calls table, or any source that throws, is listed with its error and contributes
 * nothing. The handed-in db keeps loadRunCalls' own behaviour (it creates the table when missing).
 */
export const loadRunCallsFrom = (sources, windows, runWindow) => {
  const merged = { rows: [], unattributed: 0, loggedFrom: null, loggedTotal: 0, dbs: [] };
  for (const { label, db, isReadOnly } of sources) {
    try {
      const isUsable = !isReadOnly || hasLedger(db);
      const loaded = isUsable ? loadRunCalls(db, windows, runWindow) : null;
      merged.dbs.push({ label, calls: loaded ? loaded.rows.length : 0, logged: loaded ? loaded.loggedTotal : 0, error: loaded ? null : 'no tool_calls table' });
      merged.rows.push(...(loaded?.rows ?? []));
      merged.unattributed += loaded?.unattributed ?? 0;
      merged.loggedTotal += loaded?.loggedTotal ?? 0;
      merged.loggedFrom = earlier(merged.loggedFrom, loaded?.loggedFrom);
    } catch (error) {
      merged.dbs.push({ label, calls: 0, logged: 0, error: String(error?.message ?? error) });
    }
  }
  return merged;
};
