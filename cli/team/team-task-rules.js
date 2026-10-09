/**
 * team-task-rules.js: the rules that currently have open backlog tasks.
 * Single responsibility: read the task list from the index db for refactor-prompt Action lines,
 * so every prompt builder reports the real backlog and not whether triage ran in this process.
 */

import { openIndexDb } from '../search-db.js';
import { collectTaskRules } from '../audit/prompt-rule-lines.js';
import { listTasks } from './team-db-tasks.js';

/**
 * @param {string} cwd
 * @returns {string[]|undefined} undefined when no index db is available (backlog unknown)
 */
export const loadTaskRules = (cwd) => {
  const db = openIndexDb(cwd);
  const hasDb = Boolean(db);
  if (!hasDb) return undefined;
  return collectTaskRules(listTasks(db));
};
