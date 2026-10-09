/**
 * Chemical X Protocol: capability tier ("needs") helpers for tasks.
 * needs is light | standard | deep (nullable) and says how capable an agent must be
 * to do the task. Triage derives it from the audit rule; `task add --needs=` sets it
 * by hand. A group task carries the highest tier among its children.
 */

import { NEEDS_TIERS, resolveRuleNeeds } from '../audit/rules-registry.js';

const OPEN_STATUSES = ['queued', 'in_progress', 'review'];
const RULE_SEPARATOR = /[,\s]+/;

export { NEEDS_TIERS };

export const isValidNeeds = (value) => NEEDS_TIERS.includes(value);

const needsRank = (needs) => NEEDS_TIERS.indexOf(needs);

/** Highest tier in the list, ignoring null and invalid entries; null when none remain. */
export const maxNeeds = (tiers = []) => {
  const valid = tiers.filter(isValidNeeds);
  const hasTiers = valid.length > 0;
  if (!hasTiers) return null;
  return valid.reduce((highest, tier) => (needsRank(tier) > needsRank(highest) ? tier : highest));
};

/**
 * Normalise a user-supplied needs value: unset becomes null, a valid tier passes,
 * anything else throws so a typo never silently routes work to the wrong model class.
 */
export const parseNeedsInput = (value) => {
  const isUnset = value === undefined || value === null || value === '';
  if (isUnset) return null;
  const normalized = String(value).trim().toLowerCase();
  if (isValidNeeds(normalized)) return normalized;
  throw new Error(`Invalid needs "${value}": expected one of ${NEEDS_TIERS.join(', ')}`);
};

/** Tier for a rule id, or for a comma separated list of rule ids (highest wins). */
export const needsForRules = (ruleIds) => {
  const rules = String(ruleIds || '').split(RULE_SEPARATOR).filter(Boolean);
  const hasRules = rules.length > 0;
  if (!hasRules) return null;
  return maxNeeds(rules.map(resolveRuleNeeds));
};

/** Raise a group task to the highest tier among its children (never lowers it). */
export const rollUpParentNeeds = (db, parentId) => {
  const hasParent = Boolean(db) && Boolean(parentId);
  if (!hasParent) return null;
  const children = db.prepare('SELECT needs FROM agent_tasks WHERE parent_id = ?').all(Number(parentId));
  const childMax = maxNeeds(children.map((child) => child.needs));
  const parent = db.prepare('SELECT needs FROM agent_tasks WHERE id = ?').get(Number(parentId));
  const hasChildTier = childMax !== null;
  const hasParentRow = Boolean(parent);
  const canRaise = hasChildTier && hasParentRow;
  if (!canRaise) return parent?.needs ?? null;
  const target = maxNeeds([parent.needs, childMax]);
  const isChanged = target !== parent.needs;
  if (isChanged) db.prepare('UPDATE agent_tasks SET needs = ? WHERE id = ?').run(target, Number(parentId));
  return target;
};

/**
 * Re-triage: open audit tasks that predate the needs column (needs IS NULL) get the tier
 * of their rule; group tasks then take the highest tier among their children.
 * Returns the ids that were updated.
 */
export const backfillAuditTaskNeeds = (db) => {
  if (!db) return [];
  const placeholders = OPEN_STATUSES.map(() => '?').join(', ');
  const untiered = db.prepare(`
    SELECT id, rule_id, parent_id FROM agent_tasks
    WHERE needs IS NULL AND origin_type = 'audit' AND rule_id != '' AND status IN (${placeholders})
  `).all(...OPEN_STATUSES);
  const update = db.prepare('UPDATE agent_tasks SET needs = ? WHERE id = ?');
  const updatedIds = [];
  const parentIds = new Set();
  for (const task of untiered) {
    const needs = needsForRules(task.rule_id);
    const hasNeeds = needs !== null;
    if (!hasNeeds) continue;
    update.run(needs, task.id);
    updatedIds.push(task.id);
    const hasParent = Boolean(task.parent_id);
    if (hasParent) parentIds.add(task.parent_id);
  }
  for (const parentId of parentIds) rollUpParentNeeds(db, parentId);
  return updatedIds;
};

/** Non-throwing parseNeedsInput for CLI/MCP entry points: { needs } or { error }. */
export const checkNeedsInput = (value) => {
  const isUnset = value === undefined || value === null || value === '';
  if (isUnset) return { needs: null };
  const normalized = String(value).trim().toLowerCase();
  if (isValidNeeds(normalized)) return { needs: normalized };
  return { error: `Invalid needs "${value}": expected one of ${NEEDS_TIERS.join(', ')}` };
};
