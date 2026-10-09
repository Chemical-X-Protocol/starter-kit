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

// The one sentence every doc, help string and shim uses for line budgets (AGENTS.md section 1.A).
export const describeLineBudgetPolicy = () => {
  const pragmatic = PROFILES[DEFAULT_PROFILE].maxLineCountWarning;
  const strict = PROFILES['atomic-strict'].maxLineCountWarning;
  return `Line budget: soft warning at ${pragmatic} lines when complexity is high (default profile); --profile=atomic-strict caps capsules at ${strict} lines.`;
};

export const getProfileDefaults = (profileName = DEFAULT_PROFILE) => {
  const normalized = String(profileName || DEFAULT_PROFILE).toLowerCase();
  return PROFILES[normalized] || PROFILES[DEFAULT_PROFILE];
};
