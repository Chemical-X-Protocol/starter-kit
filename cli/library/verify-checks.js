// The pure (no subprocess) checks of the library verification spec. Each returns { name, ok, detail }.
// Rule-dependent checks (parse, audit, autofix, negatives) are the subset a ruleset bump re-runs.
import fs from 'node:fs';
import path from 'node:path';
import { auditCode } from '../audit/rules.js';
import { autofixContent } from '../audit/autofix-content.js';
import { getProfileDefaults } from '../config/profiles.js';
import { computePieceFp, unitsOfText, unitsMatchFp } from './entry-fp.js';

const STRICT = Object.freeze({ rules: getProfileDefaults('atomic-strict') });

const result = (name, ok, detail = '') => ({ name, ok, detail });

const auditRules = (text, entry) => auditCode(text, entry.defaultModule, entry.defaultModule, { config: STRICT }).map((v) => v.rule);

const holeText = (locate) => locate.identifier ?? locate.commentText ?? locate.stringLiteral;

const isHoleLocated = (hole, text) => {
  const needle = holeText(hole.locate);
  const isIdentifier = Boolean(hole.locate.identifier);
  const wordBoundary = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const isFound = isIdentifier ? wordBoundary.test(text) : text.includes(needle);
  const defaultMatches = hole.kind !== 'name' || hole.default === needle;
  return isFound && defaultMatches;
};

export const checkSchema = (item) => result('schema', item.problems.length === 0, item.problems.join('; '));

export const checkParse = (item, text) => {
  const { units, error } = unitsOfText(item.entry.defaultModule, text);
  const hasExport = computePieceFp(item.entry, text) !== null;
  const detail = error ? `parse error line ${error.line}: ${error.message}` : 'no fn unit named by exportName';
  return result('parse', !error && hasExport && units.length > 0, detail);
};

export const checkHoles = (item, text) => {
  const missing = item.entry.holes.filter((hole) => !isHoleLocated(hole, text)).map((hole) => hole.id);
  return result('holes', missing.length === 0, `holes not found in the piece: ${missing.join(', ')}`);
};

/** Verification (ii): every rule, atomic-strict profile, zero violations. */
export const checkAudit = (item, text) => {
  const rules = [...new Set(auditRules(text, item.entry))];
  return { ...result('audit', rules.length === 0, `reports ${rules.join(', ')}`), rules };
};

/** The piece is a fixed point of the content autofix (interaction matrix, autofix half). */
export const checkAutofix = (item, text) => {
  const fixed = autofixContent(text, { filePath: item.entry.defaultModule });
  return result('autofix', fixed.fixedContent === text, 'autofix would rewrite the piece');
};

/** Verification (v): the recomputed fp equals entry.json. */
export const checkFp = (item, text) => {
  const fp = computePieceFp(item.entry, text);
  const isEqual = Boolean(fp) && ['l1', 'l2', 'l3'].every((level) => fp[level] === item.entry.fp[level]);
  return result('fp', isEqual, `recomputed ${JSON.stringify(fp)}`);
};

/** Verification (vi), first half: an alias sourced from the piece itself matches the piece fp. */
export const checkAliases = (item, text) => {
  const fp = computePieceFp(item.entry, text);
  const selfAliases = item.entry.aliases.filter((alias) => alias.source === 'piece');
  const stale = selfAliases.filter((alias) => !fp || fp[alias.level] !== alias.fp);
  return result('aliases', stale.length === 0, `aliases that no longer match the piece: ${stale.map((alias) => alias.fp).join(', ')}`);
};

const checkOneNegative = (item, negative, fp) => {
  const text = fs.readFileSync(path.join(item.dir, negative.file), 'utf-8');
  const isReports = negative.expect === 'reports';
  if (isReports) {
    const rules = auditRules(text, item.entry);
    return { file: negative.file, ok: rules.includes(negative.rule), detail: `expected ${negative.rule}, got [${rules.join(', ')}]` };
  }
  const { units } = unitsOfText(item.entry.defaultModule, text);
  return { file: negative.file, ok: !unitsMatchFp(units, fp), detail: 'a unit of the negative matches the piece fp' };
};

/** Verification (vi), second half: no noMatch negative matches, every reports negative reports its rule. */
export const checkNegatives = (item, text) => {
  const fp = computePieceFp(item.entry, text);
  const outcomes = item.entry.negatives.map((negative) => checkOneNegative(item, negative, fp ?? item.entry.fp));
  const failed = outcomes.filter((outcome) => !outcome.ok);
  return result('negatives', failed.length === 0, failed.map((outcome) => `${outcome.file}: ${outcome.detail}`).join('; '));
};

/** The rule-dependent checks, in order. A ruleset bump re-runs exactly these. */
export const RULE_CHECKS = Object.freeze([checkParse, checkAudit, checkAutofix, checkNegatives]);
export const STATIC_CHECKS = Object.freeze([checkHoles, checkFp, checkAliases]);
