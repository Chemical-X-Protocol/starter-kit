/**
 * Chemical X Protocol: per-call ledger for `chemx report savings` (#2498).
 * Every MCP call (runLoggedMcp) and every CLI command (runLoggedCli) inserts one tool_calls row:
 * handle, time, action, result size in characters. Nothing else about the call is stored (see
 * call-schema.js). Where chemx knows what the native alternative would have returned, the code that
 * produced the result calls noteCounterfactual(kind, { chars | calls }) with a number. Only a fixed list
 * of kinds is accepted and only numbers are kept, so no content can reach the table.
 * Fails open: any problem opening or writing the db is swallowed and the call proceeds untouched.
 * Off in spec processes and with CHEMX_CALL_LOG=0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { initCallSchema, COUNTERFACTUAL_KINDS } from './call-schema.js';
import { isForbiddenRoot, isInsideTempDir } from '../project-markers.js';

export const CHARS_PER_TOKEN = 4;
/** Token estimate used everywhere in the report: characters / 4, rounded up. An estimate, not a tokenizer count. */
export const estimateTokens = (chars) => Math.ceil((Number(chars) || 0) / CHARS_PER_TOKEN);

const scope = new AsyncLocalStorage();

const CLI_SKIPPED = new Set(['mcp', 'mcp-server', 'server', 'report', 'help', '--help', '-h']);
const ACTION_ALIASES = { r: 'read', view: 'read', search: 'q', query: 'q', find: 'q', diff: 'd', edit: 'patch', pkg: 'p', ls: 'f', json: 'j' };
const NO_COUNTERFACTUAL = { kind: null, chars: 0, calls: 0 };

export const isLoggingOn = (env = process.env) => {
  const isOptedOut = env.CHEMX_CALL_LOG === '0';
  const isSpec = Boolean(env.VITEST) || Boolean(env.NODE_TEST_CONTEXT);
  return !isOptedOut && !isSpec;
};

export const normalizeAction = (name) => {
  const text = String(name || 'unknown');
  return ACTION_ALIASES[text] || text;
};

const toCount = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/**
 * Called by chemx code that knows a counterfactual size. The first note of a kind in a call wins (the
 * call's own target is read before any helper reads). Outside a logged call it does nothing.
 */
export const noteCounterfactual = (kind, { chars = 0, calls = 0 } = {}) => {
  const store = scope.getStore();
  const isKnownKind = COUNTERFACTUAL_KINDS.includes(kind);
  const canNote = Boolean(store) && isKnownKind && !store.notes.has(kind);
  if (canNote) store.notes.set(kind, { chars: toCount(chars), calls: toCount(calls) });
};

/** Size of a result in characters, as chemx serialised it. */
export const measureChars = (output) => {
  const isText = typeof output === 'string';
  const isEmpty = output === undefined || output === null;
  if (isText) return output.length;
  if (isEmpty) return 0;
  try {
    return JSON.stringify(output)?.length ?? 0;
  } catch {
    return 0;
  }
};

/** One counterfactual per call, and only when it is unambiguous: a single noted kind in a non-batch call. */
export const pickCounterfactual = (notes, isBatch = false) => {
  const kinds = [...notes.keys()];
  const isUnambiguous = kinds.length === 1 && !isBatch;
  return isUnambiguous ? { kind: kinds[0], ...notes.get(kinds[0]) } : NO_COUNTERFACTUAL;
};

const INSERT_SQL = `INSERT INTO tool_calls (ts, agent, surface, action, ok, result_chars, cf_kind, cf_chars, cf_calls, session)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const clean = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The session id a call ran under (CHEMX_SESSION_ID, set by the SessionStart hook), or null. */
export const sessionOf = (env = process.env) => clean(env?.CHEMX_SESSION_ID) ?? null;

const singleSessionHandle = (db, sessionId) => {
  try {
    initCallSchema(db);
    const rows = db.prepare('SELECT handle FROM session_handles WHERE session_id = ?').all(sessionId);
    return rows.length === 1 ? rows[0].handle : null;
  } catch {
    return null;
  }
};

/**
 * #4465: whose call is this. In order: the explicit handle (--as, params.agentId), CHEMX_AGENT_ID or
 * CHEMX_AGENT, then the handle the session map holds for this call's session when it holds exactly one.
 * Else null, stored as NULL and counted as unattributed. It never guesses: one MCP server shared by
 * several concurrent subagents has one environment, so env alone cannot tell them apart.
 */
export const resolveHandle = (explicit, env = process.env, db = null) => {
  const direct = clean(explicit) ?? clean(env?.CHEMX_AGENT_ID) ?? clean(env?.CHEMX_AGENT);
  if (direct) return direct;
  const sessionId = sessionOf(env);
  return sessionId && db ? singleSessionHandle(db, sessionId) : null;
};

/** Record that a session acts as a handle. Several handles for one session make it ambiguous. */
export const mapSession = (db, sessionId, handle) => {
  try {
    initCallSchema(db);
    db.prepare('INSERT OR IGNORE INTO session_handles (session_id, handle) VALUES (?, ?)').run(sessionId, handle);
    return true;
  } catch {
    return false;
  }
};

/** Logged calls with and without a handle in a time window. share is null when nothing was logged. */
export const unattributedStats = (db, start = 0, end = Number.MAX_SAFE_INTEGER) => {
  initCallSchema(db);
  const { total, unattributed } = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(agent IS NULL), 0) AS unattributed FROM tool_calls WHERE ts >= ? AND ts <= ?').get(start, end);
  return { total, unattributed, share: total ? unattributed / total : null };
};

/**
 * Fill NULL agents from the session map, only for sessions that map to exactly one handle.
 * Returns { updated, ambiguousSessions }. Rows with no session, or an unmapped or ambiguous one, stay NULL.
 */
export const reattributeCalls = (db) => {
  initCallSchema(db);
  const sessions = db.prepare('SELECT session_id, COUNT(*) AS n, MIN(handle) AS handle FROM session_handles GROUP BY session_id').all();
  const update = db.prepare('UPDATE tool_calls SET agent = ? WHERE agent IS NULL AND session = ?');
  let updated = 0;
  let ambiguousSessions = 0;
  for (const entry of sessions) {
    const isAmbiguous = entry.n !== 1;
    ambiguousSessions += isAmbiguous ? 1 : 0;
    updated += isAmbiguous ? 0 : Number(update.run(entry.handle, entry.session_id).changes);
  }
  return { updated, ambiguousSessions };
};

/** Insert one row. Returns false (never throws) when the db is missing or the write fails. */
export const recordCall = (db, row) => {
  try {
    initCallSchema(db);
    const cf = row.cf || NO_COUNTERFACTUAL;
    db.prepare(INSERT_SQL).run(row.ts, row.agent || null, row.surface, normalizeAction(row.action), row.ok ? 1 : 0, toCount(row.resultChars), cf.kind, cf.chars, cf.calls, row.session || null);
    return true;
  } catch {
    return false;
  }
};

const LEDGER_BUSY_MS = 250;

/**
 * The index db the call is running against: CHEMX_PROJECT_ROOT, else the nearest ancestor of cwd that
 * already has .chemx/index.db. It never creates a db. Light on purpose: loading the full index stack
 * costs about 330ms of CPU per CLI call, a direct sqlite open costs about 1ms.
 * The walk never reaches the OS temp dir, its ancestors or / (#2570: a stray /tmp/.chemx), and a spec
 * process (env.NODE_TEST_CONTEXT) gets no db outside the temp dir (#2581).
 */
export const findLedgerDbPath = (cwd, env = process.env) => {
  const dirs = [];
  for (let dir = path.resolve(env.CHEMX_PROJECT_ROOT || cwd); !dirs.includes(dir) && !isForbiddenRoot(dir); dir = path.dirname(dir)) dirs.push(dir);
  const hit = dirs.map((dir) => path.join(dir, '.chemx', 'index.db')).find((file) => fs.existsSync(file));
  const isSpecRefused = Boolean(hit) && Boolean(env.NODE_TEST_CONTEXT) && !isInsideTempDir(hit);
  return isSpecRefused ? null : hit || null;
};

const closeQuietly = (handle) => {
  try {
    handle?.release();
  } catch { // chemx-allow: best-effort closing a ledger connection never fails a call
  }
};

/** Default opener: { db, release } on the project's index db, or null. A short busy wait keeps a call from stalling. */
const openLedgerDb = async (cwd, env = process.env) => {
  try {
    const file = findLedgerDbPath(cwd, env);
    if (!file) return null;
    await import('../silence-warnings.js');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout = ${LEDGER_BUSY_MS}`);
    return { db, release: () => db.close() };
  } catch {
    return null;
  }
};

const recordAndRelease = (handle, row) => {
  try {
    recordCall(handle?.db, row);
  } finally {
    closeQuietly(handle);
  }
};

const asFromWords = (words) => {
  const hit = words.find((word) => word.startsWith('--as='));
  return hit ? hit.slice('--as='.length) : undefined;
};

const handleOfMcp = (args) => {
  const params = args?.params ?? {};
  const words = typeof args?.command === 'string' ? args.command.split(' ') : [];
  return params.agentId ?? params.as ?? args?.agentId ?? args?.as ?? asFromWords(words);
};

const isBatchArgs = (args) => Array.isArray(args?.commands) || Array.isArray(args?.batch);

const actionOfMcp = (toolName, args) => {
  const words = typeof args?.command === 'string' ? args.command.trim().split(' ') : [];
  return isBatchArgs(args) ? 'batch' : (args?.action ?? words[0] ?? toolName);
};

/** Run one MCP tool call and log it. The call's result and errors pass through unchanged. */
export const runLoggedMcp = async ({ toolName, args, cwd, run, openDb = openLedgerDb, now = Date.now, env = process.env }) => {
  if (!isLoggingOn(env)) return run();
  const store = { notes: new Map() };
  let output;
  let isOk = true;
  try {
    output = await scope.run(store, run);
    return output;
  } catch (err) {
    isOk = false;
    throw err;
  } finally {
    const handle = await openDb(cwd, env);
    const cf = pickCounterfactual(store.notes, isBatchArgs(args));
    const agent = resolveHandle(handleOfMcp(args), env, handle?.db);
    recordAndRelease(handle, { ts: now(), agent, session: sessionOf(env), surface: 'mcp', action: actionOfMcp(toolName, args), ok: isOk, resultChars: measureChars(output), cf });
  }
};

const meterOutput = () => {
  let chars = 0;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      chars += typeof chunk === 'string' ? chunk.length : (chunk?.byteLength ?? 0);
      return write(chunk, ...rest);
    };
  }
  return () => chars;
};

/**
 * Run one CLI command and log it when the process exits (commands may call process.exit). The result
 * size is what the command wrote to stdout and stderr, counted as it was written.
 */
export const runLoggedCli = async ({ command, rawArgs, cwd, run, openDb = openLedgerDb, now = Date.now, env = process.env }) => {
  const isSkipped = !isLoggingOn(env) || CLI_SKIPPED.has(command);
  if (isSkipped) return run();
  const handle = await openDb(cwd, env);
  if (!handle) return run();
  const store = { notes: new Map() };
  const written = meterOutput();
  const agent = resolveHandle(asFromWords(rawArgs), env, handle.db);
  process.once('exit', (code) => {
    const cf = pickCounterfactual(store.notes);
    recordAndRelease(handle, { ts: now(), agent, session: sessionOf(env), surface: 'cli', action: command, ok: code === 0, resultChars: written(), cf });
  });
  return scope.run(store, run);
};
