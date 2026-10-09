// Record a `# chemx-bypass: <reason>` in the coordination db's feed so `chemx team audit-run` can count
// bypasses per handle. Cheap and fail open: it only appends to a db file that already exists (never
// creates or migrates one), waits at most BUSY_TIMEOUT_MS for a writer, and swallows every error
// (no sqlite, no db, no feed table, locked db). The db is touched only for a bypass that actually
// overrode a rule. It writes to the db the coordination resolver picks for root (teamRootFor), the
// same db the team commands read; a spec process is refused and logs nothing.

import fs from 'node:fs';

export const BYPASS_EVENT_TYPE = 'guard-bypass';
export const BUSY_TIMEOUT_MS = 400;
const COMMAND_LIMIT = 240;

export const bypassMessage = ({ reason, rule, command }) => `bypass ${rule ?? 'unknown-rule'}: ${reason} | ${String(command ?? '').slice(0, COMMAND_LIMIT)}`;

const appendBypass = async (file, fields) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { postFeedEvent } = await import('../team/team-db-feed.js');
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    return postFeedEvent(db, fields) !== null;
  } finally {
    db.close();
  }
};

export const logBypassToDb = async ({ root, handle, reason, rule, command, session }) => {
  try {
    const { resolveTeamDbTarget } = await import('../team/coordination-target.js');
    const target = resolveTeamDbTarget(root);
    const file = target.dbPath;
    const hasDb = !target.refused && fs.existsSync(file);
    if (!hasDb) return false;
    return await appendBypass(file, {
      author_id: handle ?? '@claude',
      event_type: BYPASS_EVENT_TYPE,
      message: bypassMessage({ reason, rule, command }),
      metadata: { rule: rule ?? null, reason, command: String(command ?? '').slice(0, COMMAND_LIMIT), session: session ?? null },
    });
  } catch {
    return false; // bypass logging must never fail a tool call
  }
};
