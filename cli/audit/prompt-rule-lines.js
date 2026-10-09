/**
 * prompt-rule-lines.js: per-rule lines of the generated refactor prompt.
 * Single responsibility: the needs tier line and the backlog Action line for one rule.
 */

import { resolveRuleNeeds } from './rules-registry.js';

const OPEN_TASK_STATUSES = new Set(['queued', 'in_progress', 'review']);

/**
 * Rules that currently have open tasks, from a task list. A task's rule_id may hold a
 * comma-separated list for grouped tasks.
 * @param {Array<{status?: string, rule_id?: string}>} tasks
 * @returns {string[]}
 */
export const collectTaskRules = (tasks = []) => {
  const rules = new Set();
  for (const task of tasks) {
    const isOpen = OPEN_TASK_STATUSES.has(task.status);
    if (!isOpen) continue;
    const ids = String(task.rule_id || '').split(',').map((id) => id.trim()).filter(Boolean);
    ids.forEach((id) => rules.add(id));
  }
  return [...rules];
};

/**
 * @param {string} rule
 * @returns {string}
 */
export const buildNeedsLine = (rule) => `   Needs:     ${resolveRuleNeeds(rule)}`;

/**
 * The Action line is printed only when the rule has tasks. An unknown backlog (no taskRules)
 * prints nothing, so agents are never pointed at an empty list.
 * @param {string} rule
 * @param {string[]|undefined} taskRules
 * @returns {string|null}
 */
export const buildActionLine = (rule, taskRules) => {
  const hasBacklogInfo = Array.isArray(taskRules);
  if (!hasBacklogInfo) return null;
  const hasTasks = taskRules.includes(rule);
  if (!hasTasks) return null;
  return `   Action:    chemx team task list --rule=${rule}`;
};
