/**
 * Chemical X Architectural Profiles
 * Defines structural thresholds for Pragmatic, Atomic-Strict, and Loose modes.
 */

export const PROFILES = {
  pragmatic: {
    profile: 'pragmatic',
    name: 'Pragmatic Staff Engineer (Default)',
    description: 'Audits structural weight, cyclomatic complexity, hook density, and AI slop without dogmatic line caps.',
    maxCyclomaticComplexity: 12,
    maxHookDensity: 4,
    maxRenderDepth: 4,
    maxPropCount: 7,
    preferDesignTokens: 'warning',
    enforceFileLength: false,
    enforceColocatedTests: false,
    ruleOfThreeAbstractions: true,
    aiSlopDetection: 'critical',
    maxLineCountWarning: 250
  },
  'atomic-strict': {
    profile: 'atomic-strict',
    name: 'Atomic-Strict Design System',
    description: 'Original dogmatic 100-line capsule limit and zero-raw-DOM mandate for design system primitives.',
    maxCyclomaticComplexity: 10,
    maxHookDensity: 3,
    maxRenderDepth: 3,
    maxPropCount: 5,
    preferDesignTokens: 'error',
    enforceFileLength: true,
    enforceColocatedTests: true,
    ruleOfThreeAbstractions: false,
    aiSlopDetection: 'critical',
    maxLineCountWarning: 100
  },
  loose: {
    profile: 'loose',
    name: 'Loose / Rapid Prototyping',
    description: 'Permissive thresholds for hackathons, early prototyping, and legacy codebases.',
    maxCyclomaticComplexity: 25,
    maxHookDensity: 8,
    maxRenderDepth: 6,
    maxPropCount: 12,
    preferDesignTokens: 'off',
    enforceFileLength: false,
    enforceColocatedTests: false,
    ruleOfThreeAbstractions: true,
    aiSlopDetection: 'medium',
    maxLineCountWarning: 500
  }
};

export const DEFAULT_PROFILE = 'pragmatic';

export const getProfileDefaults = (profileName = DEFAULT_PROFILE) => {
  const normalized = String(profileName || DEFAULT_PROFILE).toLowerCase();
  return PROFILES[normalized] || PROFILES[DEFAULT_PROFILE];
};

export const STRICT_MOLECULE_LINE_LIMIT = 100;
export const DEFAULT_MOLECULE_LINE_LIMIT = 250;

// Accepts a flat rule set or a loaded config whose rules live under `rules`.
const toRuleSet = (config) => config?.rules || config || {};

export const isFileLengthEnforced = (config) => {
  const rules = toRuleSet(config);
  const isLengthFlagged = rules.enforceFileLength === true;
  const isStrictProfile = rules.profile === 'atomic-strict';
  return isLengthFlagged || isStrictProfile;
};

export const resolveMoleculeLineLimit = (config) => {
  const isStrict = isFileLengthEnforced(config);
  const warningLimit = toRuleSet(config).maxLineCountWarning || DEFAULT_MOLECULE_LINE_LIMIT;
  return isStrict ? STRICT_MOLECULE_LINE_LIMIT : warningLimit;
};
