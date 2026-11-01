/**
 * The absolute floors of `chemx audit`: --min-grade and --min-score. For each floor the first
 * source with a usable value wins: the flag, then CHEMX_MIN_GRADE / CHEMX_MIN_SCORE, then
 * minGrade / minScore in .chemx/config.json, then --default-min-grade / --default-min-score, then
 * CHEMX_DEFAULT_MIN_GRADE / CHEMX_DEFAULT_MIN_SCORE. The defaults are for a caller with a fallback
 * of its own, so that fallback applies only where the project sets nothing (#255). The pre-commit
 * hooks export the env pair rather than pass the flags, since a chemx from before #255 ignores an
 * unknown env name but refuses an unknown flag (#253).
 *
 * A usable grade is A+, A, B, C, D or F in any case. A usable score is an integer from 0 to 100;
 * an integer-valued decimal (100.0, 85.00) counts as that integer, and 95.5, 150 or 1e2 do not.
 * A flag takes its value as --min-score=90 or as the next word, --min-score 90; the first
 * occurrence wins. An empty value is unset. An unusable flag value, or a flag with no word after
 * it (or with a long flag next), is a usage error, since it was typed for this run. So is an
 * unusable CHEMX_MIN_GRADE / CHEMX_MIN_SCORE, the operator's own setting: skipping it could leave
 * no floor where 4ea6eb2 read 98.5 as 98 (#253). An unusable config or CHEMX_DEFAULT_MIN_* value
 * gets a one-line warning and the next source applies. No floor at all is
 * { minGrade: '', minScore: null }. A quoted value prints only printable ASCII.
 */
import { isKnownGrade } from './rules-predicates.js';

const SCORE_TEXT = /^\d{1,3}(?:\.0+)?$/;
const MAX_SCORE = 100;
const CONFIG_FILE = '.chemx/config.json';

// One flag source: --name=value, or --name value as two words (#253). A bare --name is missing its value.
// A flag is strict: an unusable value refuses the run instead of falling through.
const flagSource = (rawArgs, name) => {
  const args = rawArgs.map(String);
  const at = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  const isAbsent = at === -1;
  if (isAbsent) return { name, value: undefined, isStrict: true };
  const isInline = args[at] !== name;
  if (isInline) return { name, value: args[at].slice(name.length + 1), isStrict: true };
  const next = args[at + 1];
  const isMissing = next === undefined || next.startsWith('--');
  return { name, value: next, isStrict: true, isMissing };
};

const toGrade = (value) => {
  const grade = String(value).trim().toUpperCase();
  return isKnownGrade(grade) ? grade : null;
};

const toScore = (value) => {
  const text = String(value).trim();
  const isInRange = SCORE_TEXT.test(text) && Number(text) <= MAX_SCORE;
  return isInRange ? Number(text) : null;
};

const FLOORS = {
  minGrade: { parse: toGrade, hint: 'use A+, A, B, C, D or F', flag: '--min-grade', env: 'CHEMX_MIN_GRADE', defaultFlag: '--default-min-grade', defaultEnv: 'CHEMX_DEFAULT_MIN_GRADE' },
  minScore: { parse: toScore, hint: 'use an integer from 0 to 100', flag: '--min-score', env: 'CHEMX_MIN_SCORE', defaultFlag: '--default-min-score', defaultEnv: 'CHEMX_DEFAULT_MIN_SCORE' }
};

// One floor's sources in precedence order: flag, env, config, default flag, default env.
// CHEMX_MIN_* is strict like a flag (#253); the config and CHEMX_DEFAULT_MIN_* fall through.
const sourcesOf = (key, rawArgs, env, projectConfig) => {
  const floor = FLOORS[key];
  return [
    flagSource(rawArgs, floor.flag),
    { name: floor.env, value: env?.[floor.env], isStrict: true },
    { name: key, value: projectConfig?.[key], where: ` in ${CONFIG_FILE}` },
    flagSource(rawArgs, floor.defaultFlag),
    { name: floor.defaultEnv, value: env?.[floor.defaultEnv] }
  ];
};

const isUnset = (value) => value === undefined || value === null || String(value).trim() === '';

// JSON quoting keeps a value with a newline or an escape code on one line of plain text, and every
// code unit outside printable ASCII becomes a \u escape, so a C1 control (U+0080 to U+009F) or a
// bidi override from a cloned repo's config never reaches the terminal raw (#253).
const OUTSIDE_PRINTABLE_ASCII = /[^\x20-\x7e]/g;
const toUnicodeEscape = (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;
const toPrintable = (value) => JSON.stringify(String(value)).replace(OUTSIDE_PRINTABLE_ASCII, toUnicodeEscape);
const quoted = (source) => `${source.name} value ${toPrintable(source.value)}${source.where ?? ''}`;

const refusal = (usageError) => ({ value: null, warnings: [], usageError });

const resolveFloor = (key, rawArgs, env, projectConfig) => {
  const floor = FLOORS[key];
  const sources = sourcesOf(key, rawArgs, env, projectConfig).filter((source) => source.isMissing || !isUnset(source.value));
  const bareFlag = sources.find((source) => source.isMissing);
  if (bareFlag) return refusal(`chemx audit: ${bareFlag.name} needs a value (${floor.hint}).`);
  const badStrict = sources.find((source) => source.isStrict && floor.parse(source.value) === null);
  if (badStrict) return refusal(`chemx audit: ${quoted(badStrict)} is not a usable floor (${floor.hint}).`);
  const warnings = [];
  for (const source of sources) {
    const parsed = floor.parse(source.value);
    const isUsable = parsed !== null;
    if (isUsable) return { value: parsed, warnings, usageError: null };
    warnings.push(`chemx audit: ignoring ${quoted(source)} (${floor.hint}); the next floor source applies.`);
  }
  return { value: null, warnings, usageError: null };
};

/** @returns {{ minGrade: string, minScore: number|null, warnings: string[], usageError: string|null }} */
export const resolveAuditFloors = (rawArgs = [], env = process.env, projectConfig = {}) => {
  const grade = resolveFloor('minGrade', rawArgs, env, projectConfig);
  const score = resolveFloor('minScore', rawArgs, env, projectConfig);
  return {
    minGrade: grade.value ?? '',
    minScore: score.value,
    warnings: [...grade.warnings, ...score.warnings],
    usageError: grade.usageError ?? score.usageError
  };
};
