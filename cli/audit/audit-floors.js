/**
 * The absolute floors of `chemx audit`: --min-grade and --min-score. For each floor the first
 * source with a usable value wins: the flag, then CHEMX_MIN_GRADE / CHEMX_MIN_SCORE, then
 * minGrade / minScore in .chemx/config.json, then --default-min-grade / --default-min-score.
 * The default flags are for a caller with a fallback of its own, such as the pre-commit grade
 * gate, so that fallback applies only where the project sets nothing (#255). A usable grade is
 * A+, A, B, C, D or F in any case; a usable score is an integer from 0 to 100. Any other value
 * is skipped and the next source applies. No floor at all is { minGrade: '', minScore: null }.
 */
import { isKnownGrade } from './rules-predicates.js';

const SCORE_TEXT = /^\d{1,3}$/;
const MAX_SCORE = 100;

const flagValue = (rawArgs, name) => {
  const prefix = `${name}=`;
  const arg = rawArgs.find((candidate) => String(candidate).startsWith(prefix));
  return arg === undefined ? undefined : String(arg).slice(prefix.length);
};

const toGrade = (value) => {
  const grade = String(value ?? '').trim().toUpperCase();
  return isKnownGrade(grade) ? grade : null;
};

const toScore = (value) => {
  const text = String(value ?? '').trim();
  const isInRange = SCORE_TEXT.test(text) && Number(text) <= MAX_SCORE;
  return isInRange ? Number(text) : null;
};

const firstUsable = (values, parse) => values.map(parse).find((parsed) => parsed !== null) ?? null;

export const resolveAuditFloors = (rawArgs = [], env = process.env, projectConfig = {}) => {
  const gradeSources = [flagValue(rawArgs, '--min-grade'), env.CHEMX_MIN_GRADE, projectConfig?.minGrade, flagValue(rawArgs, '--default-min-grade')];
  const scoreSources = [flagValue(rawArgs, '--min-score'), env.CHEMX_MIN_SCORE, projectConfig?.minScore, flagValue(rawArgs, '--default-min-score')];
  return { minGrade: firstUsable(gradeSources, toGrade) ?? '', minScore: firstUsable(scoreSources, toScore) };
};
