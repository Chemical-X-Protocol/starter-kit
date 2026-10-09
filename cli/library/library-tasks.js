// Files the "Library: <id> fails <RULE> after ruleset <v>" task (engine doc, Library: VERSIONING) in the
// coordination db. Idempotent: an open task with the same title is returned instead of a duplicate.
import { openTeamContext } from '../team/coordination-db.js';
import { createTask } from '../team/team-db-tasks.js';

const FORGE_EPIC = 2532;
const CLOSED_STATUSES = ['done', 'cancelled'];

export const quarantineTitle = (id, failures, rulesetVersion) => `Library: ${id} fails ${failures.join(', ')} after ruleset ${rulesetVersion}`;

const findOpenByTitle = (db, title) => {
  const marks = CLOSED_STATUSES.map(() => '?').join(', ');
  return db.prepare(`SELECT id FROM agent_tasks WHERE title = ? AND status NOT IN (${marks}) LIMIT 1`).get(title, ...CLOSED_STATUSES) ?? null;
};

/** Files (or finds) the quarantine task. Returns { id, isNew } or null when no coordination db is writable. */
export const fileLibraryTask = (cwd, { title, description }) => {
  const context = openTeamContext(cwd);
  const db = context.db;
  if (!db) return null;
  const existing = findOpenByTitle(db, title);
  if (existing) return { id: existing.id, isNew: false };
  const created = createTask(db, { title, description, needs: 'standard', parent_id: FORGE_EPIC, sprint_tag: 'forge', repo: context.repo });
  return created ? { id: created.id, isNew: true } : null;
};
