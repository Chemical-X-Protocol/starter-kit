// Ruleset handling (engine doc, Library: VERSIONING). After a RULESET_VERSION or RULE_REVISIONS change an
// entry is re-verified against the current rules only (milliseconds): a pass re-stamps it, a failure
// quarantines it (still used for detection, refused for heal) and files a Library: task. Blueprint ids
// never include the ruleset, so open blueprints are untouched here.
import fs from 'node:fs';
import { currentRuleset } from './entry-fp.js';
import { verifyItem } from './verify.js';
import { quarantineTitle } from './library-tasks.js';

const isStampCurrent = (stamp, ruleset) => stamp.version === ruleset.version && stamp.revisionsHash === ruleset.revisionsHash;

const failureLabels = (outcome) => {
  const rules = outcome.failedRules;
  const failedChecks = outcome.checks.filter((check) => !check.ok).map((check) => check.name);
  const hasRules = rules.length > 0;
  return hasRules ? rules : failedChecks;
};

const writeEntry = (item, entry) => fs.writeFileSync(item.entryPath, `${JSON.stringify(entry, null, 2)}\n`);

const reverifyOne = async (item, ruleset, { write, fileTask }) => {
  const { entry } = item;
  const isRetired = entry.status === 'retired';
  const isCurrent = isStampCurrent(entry.verifiedRuleset, ruleset) && entry.status === 'verified';
  const isSettled = isRetired || isCurrent;
  if (isSettled) return { id: item.id, action: isRetired ? 'retired' : 'current', task: null };
  const outcome = await verifyItem(item, { scope: 'rules' });
  const nextStatus = outcome.ok ? 'verified' : 'quarantined';
  const failures = outcome.ok ? [] : failureLabels(outcome);
  const isNewlyQuarantined = !outcome.ok && entry.status !== 'quarantined';
  const stamp = outcome.ok ? ruleset : entry.verifiedRuleset;
  if (write) writeEntry(item, { ...entry, status: nextStatus, verifiedRuleset: stamp });
  const title = quarantineTitle(item.id, failures, ruleset.version);
  const description = `${item.id} failed ${outcome.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`).join('; ')}`;
  const task = isNewlyQuarantined && fileTask ? fileTask({ id: item.id, title, description }) : null;
  return { id: item.id, action: outcome.ok ? 'restamped' : 'quarantined', failures, task };
};

/**
 * Re-verifies every entry whose stamp is not the current ruleset. options: { write (persist entry.json),
 * fileTask ({id,title,description}) => {id,isNew}|null (called once per newly quarantined entry),
 * ruleset (default: the live one) }. Returns one { id, action, failures?, task } per entry.
 */
export const reverifyLibrary = async (items, { write = false, fileTask = null, ruleset = currentRuleset() } = {}) => {
  const outcomes = [];
  for (const item of items) outcomes.push(await reverifyOne(item, ruleset, { write, fileTask }));
  return outcomes;
};
