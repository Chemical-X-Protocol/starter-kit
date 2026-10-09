/**
 * The one definition of "does this change add hazards beyond the baseline?" (#2546).
 *
 * The ratchet (chemx-ratchet.json) counts violations per rule at every severity and
 * fails a rule whose count rises. This module applies the same rule to a change: for
 * each file, a rule whose violation count is higher after the change than before it
 * is an increase, at any severity. The staged-delta pre-commit gate, task done and
 * the patch/write introducedViolations report all call it, and
 * gate-parity.spec.js proves the verdicts match a ratchet verdict on the same change.
 *
 * Guarantee: a change that adds no violations of any rule passes. A legacy file with
 * existing hazards is not blocked by them, only by new ones. Not covered: a hazard
 * that moves between rules in the same count, which is neutral per rule.
 */

const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const severityRank = (severity) => SEVERITY_ORDER.indexOf(severity);

export const countByRule = (violations = []) => {
  const counts = new Map();
  for (const v of violations) counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
  return counts;
};

const highestSeverity = (violations) => {
  const ranked = violations.map((v) => v.severity);
  return ranked.reduce((top, s) => (severityRank(s) > severityRank(top) ? s : top), 'LOW');
};

/** Violations of one rule in `after` that have no same-hazard counterpart in `before`, capped at the count rise. */
const newSitesForRule = (rule, before, after, rise) => {
  const unmatched = new Map();
  for (const v of before.filter((b) => b.rule === rule)) unmatched.set(v.hazard, (unmatched.get(v.hazard) ?? 0) + 1);
  const fresh = [];
  for (const v of after.filter((a) => a.rule === rule)) {
    const remaining = unmatched.get(v.hazard) ?? 0;
    const isMatched = remaining > 0;
    unmatched.set(v.hazard, isMatched ? remaining - 1 : 0);
    if (!isMatched) fresh.push(v);
  }
  const isExact = fresh.length === rise;
  return isExact ? fresh : fresh.slice(-rise);
};

/**
 * Per-rule increases between two violation lists of the same file.
 *
 * @returns {{ rule: string, severity: string, before: number, after: number, sites: object[] }[]} sites are the new violation objects themselves
 */
export const diffViolations = (beforeViolations = [], afterViolations = []) => {
  const before = countByRule(beforeViolations);
  const after = countByRule(afterViolations);
  const increases = [];
  for (const [rule, count] of after.entries()) {
    const was = before.get(rule) ?? 0;
    const rise = count - was;
    const isIncrease = rise > 0;
    if (!isIncrease) continue;
    const sites = newSitesForRule(rule, beforeViolations, afterViolations, rise);
    const severity = highestSeverity(afterViolations.filter((v) => v.rule === rule));
    increases.push({ rule, severity, before: was, after: count, sites });
  }
  return increases;
};

/** The individual violations a change introduced, for the patch/write report. */
export const introducedViolationsOf = (beforeViolations, afterViolations) =>
  diffViolations(beforeViolations, afterViolations).flatMap((increase) => increase.sites);

/**
 * @param {{ file: string, renamedFrom?: string, before: object[], after: object[] }[]} changes
 * @returns {{ isPassing: boolean, files: { file: string, increases: object[] }[] }}
 */
export const evaluateChanges = (changes) => {
  const files = [];
  for (const change of changes) {
    const increases = diffViolations(change.before, change.after);
    const hasIncreases = increases.length > 0;
    if (!hasIncreases) continue;
    const renamed = change.renamedFrom ? { renamedFrom: change.renamedFrom } : {};
    files.push({ file: change.file, ...renamed, increases });
  }
  return { isPassing: files.length === 0, files };
};

/** One `RULE@file:line [SEVERITY]` entry per new site, the exact list the hook prints. */
export const formatSites = (fileEntry) =>
  fileEntry.increases.flatMap((increase) =>
    increase.sites.map((site) => `${increase.rule}@${fileEntry.file}:${site.line} [${site.severity}]`)
  );
