/**
 * Per-rule configuration applied after auditCode collects violations
 * (finding config-not-honored):
 *   rules: { "RULE_ID": "off" | "low" | "medium" | "high" | "critical" }
 *   overrides: [{ files: "glob" | ["globs"], rules: { "RULE_ID": "off" | <severity> } }]
 *   A setting of "on" (or true) enables a default-off rule and keeps the engine's severities.
 *   ai-slop-detection: "off" drops AI_SLOP_* rules, "medium" caps them at MEDIUM.
 *   pillars (from .chemx/config.json): a disabled product pillar drops its rules.
 * Later overrides win over earlier ones, and every override wins over `rules`.
 */
import { globToRegExp } from './line-budgets.js';
import { resolvePillarDisabledRules } from './rule-pillars.js';
import { RULE_REGISTRY } from './rules-registry.js';

const SEVERITIES = new Map([['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['critical', 'CRITICAL']]);
const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const RULE_ID_SHAPE = /^[A-Z][A-Z0-9_]+$/;
const OFF = 'off';
const ON = 'on';

const isSlopRule = (rule) => typeof rule === 'string' && rule.startsWith('AI_SLOP_');

const normalizeSetting = (value) => {
  const lowered = String(value).toLowerCase();
  const isOff = lowered === OFF || value === false;
  if (isOff) return OFF;
  const isOn = lowered === ON || value === true;
  if (isOn) return ON;
  return SEVERITIES.get(lowered) ?? null;
};

const pickRuleSettings = (rules = {}) => {
  const settings = {};
  for (const [key, value] of Object.entries(rules)) {
    const isRuleId = RULE_ID_SHAPE.test(key);
    const setting = isRuleId ? normalizeSetting(value) : null;
    if (setting) settings[key] = setting;
  }
  return settings;
};

const toGlobList = (files) => (Array.isArray(files) ? files : [files]).filter((f) => typeof f === 'string');

const matchesAnyGlob = (relativePath, globs) => {
  const normalized = relativePath.split('\\').join('/');
  return globs.some((glob) => globToRegExp(glob).test(normalized));
};

/** Resolves the effective per-rule settings for one file. */
export const resolveRuleSettings = (relativePath, config = {}) => {
  const settings = pickRuleSettings(config.rules);
  for (const override of config.overrides || []) {
    const isApplicable = matchesAnyGlob(relativePath, toGlobList(override?.files));
    if (isApplicable) Object.assign(settings, pickRuleSettings(override.rules));
  }
  return settings;
};

const applySlopPolicy = (violation, policy) => {
  const isSlop = isSlopRule(violation.rule) || violation.isAiSlop;
  if (!isSlop) return violation;
  const isDisabled = policy === OFF;
  if (isDisabled) return null;
  const isCapped = policy === 'medium' && SEVERITY_RANK[violation.severity] > SEVERITY_RANK.MEDIUM;
  return isCapped ? { ...violation, severity: 'MEDIUM' } : violation;
};

/**
 * Applies `rules`, `overrides` and `ai-slop-detection` to one file's violations.
 * A rule is off by default when its registry entry has `isDefaultOff: true` or the caller's
 * `defaultOff` set names it, until a setting names it: "on" (or true) enables it and keeps the
 * engine's per-violation severities, a severity enables it and overwrites them.
 * options: { registry (default RULE_REGISTRY), defaultOff (Set of rule ids) }.
 */
export const applyRuleOverrides = (violations, relativePath, config = {}, options = {}) => {
  const { registry = RULE_REGISTRY, defaultOff = new Set() } = options;
  const settings = resolveRuleSettings(relativePath, config);
  const pillarDisabled = resolvePillarDisabledRules(config.pillars);
  const slopPolicy = String(config.rules?.aiSlopDetection ?? config.rules?.['ai-slop-detection'] ?? 'critical').toLowerCase();
  const result = [];
  for (const violation of violations) {
    const setting = settings[violation.rule];
    const isDefaultOff = registry[violation.rule]?.isDefaultOff === true || defaultOff.has(violation.rule);
    const isOff = setting === OFF || (!setting && (isDefaultOff || pillarDisabled.has(violation.rule)));
    if (isOff) continue;
    const isSeverityOverride = Boolean(setting) && setting !== ON;
    const withSeverity = isSeverityOverride ? { ...violation, severity: setting } : violation;
    const afterSlop = setting ? withSeverity : applySlopPolicy(withSeverity, slopPolicy);
    if (afterSlop) result.push(afterSlop);
  }
  return result;
};
