// Fingerprints of library pieces, computed with the Forge extractor itself so the library and the
// fingerprinter cannot drift (verification spec item v), and the ruleset stamp an entry is verified under.
import crypto from 'node:crypto';
import { collectFileUnits } from '../forge/file-units.js';
import { RULESET_VERSION, RULE_REVISIONS } from '../audit/rule-revisions.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { FP_LEVELS } from './entry-schema.js';

const FP_FIELD = Object.freeze({ l1: 'fp1', l2: 'fp2', l3: 'fp3' });
const HASH_LENGTH = 12;

const byCodePoint = (a, b) => Number(a > b) - Number(a < b);

/** The ruleset the audit currently enforces: { version, revisionsHash } (ids and revisions, not code). */
export const currentRuleset = () => {
  const revisions = Object.entries(RULE_REVISIONS).sort(([a], [b]) => byCodePoint(a, b));
  const body = JSON.stringify([RULESET_VERSION, revisions, Object.keys(RULE_REGISTRY).sort(byCodePoint)]);
  return { version: RULESET_VERSION, revisionsHash: crypto.createHash('sha256').update(body).digest('hex').slice(0, HASH_LENGTH) };
};

/** Units of a text as if it lived at relativePath (library/ itself is excluded from detection). */
export const unitsOfText = (relativePath, text) => collectFileUnits(relativePath, text);

const isExportUnit = (unit, exportName) => unit.kind === 'fn' && unit.declName === exportName;

/** { l1, l2, l3 } of the fn unit named by entry.exportName, or null when the piece has no such unit. */
export const computePieceFp = (entry, text) => {
  const { units } = unitsOfText(entry.defaultModule, text);
  const unit = units.find((candidate) => isExportUnit(candidate, entry.exportName));
  if (!unit) return null;
  return Object.fromEntries(FP_LEVELS.map((level) => [level, unit[FP_FIELD[level]]]));
};

/** True when any unit of `units` carries the fp at the given levels (default: every level). */
export const unitsMatchFp = (units, fp, levels = FP_LEVELS) => units.some((unit) => levels.some((level) => unit[FP_FIELD[level]] === fp[level]));
