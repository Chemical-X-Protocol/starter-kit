/**
 * team-task-rules.js: the rules that currently have open backlog tasks.
 * Single responsibility: read the cwd repo's task list from the team db (the coordination db, or
 * an unmerged package db, #2488) for refactor-prompt Action lines, so every prompt builder reports
 * the real backlog and not whether triage ran in this process.
 */

import { openTeamContext } from './coordination-db.js';
import { collectTaskRules } from '../audit/prompt-rule-lines.js';
import { listTasks } from './team-db-tasks.js';

/**
 * @param {string} cwd
 * @returns {string[]|undefined} undefined when no team db is available (backlog unknown)
 */
export const loadTaskRules = (cwd) => {
  const ctx = openTeamContext(cwd);
  const hasDb = Boolean(ctx.db);
  if (!hasDb) return undefined;
  return collectTaskRules(listTasks(ctx.db, { repo: ctx.repo }));
};
