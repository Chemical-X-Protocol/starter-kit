/**
 * Chemical X Protocol: the tool_calls table behind `chemx report savings` (#2498).
 * One row per chemx call, written by call-ledger.js. A row holds sizes and counts only: the agent
 * handle, the time, the action name, the result size in characters, and (when chemx knows it) the size
 * of what the native alternative would have returned. It never holds arguments, paths or content.
 * cf_kind says what cf_chars / cf_calls mean:
 *   file-whole       cf_chars = characters of the whole file a read window or outline came from
 *   raw-output       cf_chars = characters of the raw stdout+stderr chemx captured and summarised
 *   validation-call  cf_calls = separate check calls the in-result validation made unnecessary
 * NULL cf_kind means chemx had no counterfactual for that call.
 */

const readyDbs = new WeakSet();

export const COUNTERFACTUAL_KINDS = ['file-whole', 'raw-output', 'validation-call'];

const DDL = `
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    agent TEXT,
    surface TEXT NOT NULL,
    action TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    result_chars INTEGER NOT NULL DEFAULT 0,
    cf_kind TEXT,
    cf_chars INTEGER NOT NULL DEFAULT 0,
    cf_calls INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(ts);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent, ts);
  CREATE TABLE IF NOT EXISTS session_handles (
    session_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    PRIMARY KEY (session_id, handle)
  );
`;

/** #4465: nullable session column on tables created before it existed. Guarded, so a second run is a no-op. */
const addSessionColumn = (db) => {
  const columns = db.prepare('PRAGMA table_info(tool_calls)').all();
  const hasSession = columns.some((column) => column.name === 'session');
  if (!hasSession) db.exec('ALTER TABLE tool_calls ADD COLUMN session TEXT');
};

/** Create the table once per open db handle. */
export const initCallSchema = (db) => {
  const isUnusable = !db || readyDbs.has(db);
  if (isUnusable) return;
  db.exec(DDL);
  addSessionColumn(db);
  readyDbs.add(db);
};
