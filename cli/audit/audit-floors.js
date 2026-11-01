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
 * An empty value is unset. An unusable flag value is a usage error, since it was typed for this
 * run; an unusable env or config value gets a one-line warning and the next source applies. No
 * floor at all is { minGrade: '', minScore: null }.
 */
import { isKnownGrade } from './rules-predicates.js';

const SCORE_TEXT = /^\d{1,3}(?:\.0+)?$/;
const MAX_SCORE = 100;
const CONFIG_FILE = '.chemx/config.json';

const flagValue = (rawArgs, name) => {
  const prefix = `${name}=`;
  const arg = rawArgs.find((candidate) => String(candidate).startsWith(prefix));
  return arg === undefined ? undefined : String(arg).slice(prefix.length);
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
const sourcesOf = (key, rawArgs, env, projectConfig) => {
  const floor = FLOORS[key];
  return [
    { name: floor.flag, value: flagValue(rawArgs, floor.flag), isFlag: true },
    { name: floor.env, value: env?.[floor.env] },
    { name: key, value: projectConfig?.[key], where: ` in ${CONFIG_FILE}` },
    { name: floor.defaultFlag, value: flagValue(rawArgs, floor.defaultFlag), isFlag: true },
    { name: floor.defaultEnv, value: env?.[floor.defaultEnv] }
  ];
};

const isUnset = (value) => value === undefined || value === null || String(value).trim() === '';

// JSON quoting keeps a value with a newline or an escape code on one line of plain text.
const quoted = (source) => `${source.name} value ${JSON.stringify(String(source.value))}${source.where ?? ''}`;

const resolveFloor = (key, rawArgs, env, projectConfig) => {
  const floor = FLOORS[key];
  const sources = sourcesOf(key, rawArgs, env, projectConfig).filter((source) => !isUnset(source.value));
  const badFlag = sources.find((source) => source.isFlag && floor.parse(source.value) === null);
  if (badFlag) return { value: null, warnings: [], usageError: `chemx audit: ${quoted(badFlag)} is not a usable floor (${floor.hint}).` };
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
