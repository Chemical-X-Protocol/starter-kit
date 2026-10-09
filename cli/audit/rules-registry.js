/**
 * Audit *categories* used to group findings in reports. They are not the product
 * pillars: those are the 7 in cli/pillars-schema.js, and rule-pillars.js maps the
 * rules that enforce them. The export keeps its historical name for report code.
 */
export const PILLARS = {
  PILLAR_1: 'Line Budgets & Monolith Decomposition',
  PILLAR_2: 'Control Flow & Boolean Logic',
  PILLAR_3: 'Reactivity & Composable Contracts',
  PILLAR_4: 'Type Architecture & Data Integrity',
  PILLAR_5: 'Design System & Styling Hygiene',
  PILLAR_6: 'Timers & Macro-Task Discipline',
  PILLAR_7: 'Global Hygiene & Typography',
  PILLAR_8: 'Accessibility & Semantic Integrity',
  PILLAR_9: 'Security & Content Safety',
  PILLAR_10: 'Testing Discipline',
  PILLAR_11: 'Naming Conventions'
};

export const AUDIT_CATEGORIES = PILLARS;

export const RULE_REGISTRY = {
  // Pillar 8: Accessibility & Semantic Integrity
  A11Y_CLICKABLE_NON_SEMANTIC: {
    pillar: PILLARS.PILLAR_8,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Replace clickable generic container with native interactive element (<button> or <a>)'
  },
  A11Y_IMAGE_MISSING_ALT: {
    pillar: PILLARS.PILLAR_8,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Provide meaningful alt text or alt="" for decorative images'
  },

  // Pillar 9: Security & Content Safety
  SECURITY_RAW_HTML_INJECTION: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Sanitize dynamic HTML via DOMPurify before injecting into v-html or dangerouslySetInnerHTML'
  },
  SECURITY_HARDCODED_SECRET: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Extract hardcoded API keys and secrets into environment variables or secrets manager'
  },
  SECURITY_REVERSE_TABNABBING: {
    pillar: PILLARS.PILLAR_9,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Add rel="noopener noreferrer" to external links with target="_blank" to prevent tab hijacking'
  },
  SECURITY_JAVASCRIPT_URL: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Do not use javascript: pseudo-protocol in links or action attributes; use event handlers'
  },
  SECURITY_DYNAMIC_CODE_EXECUTION: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Avoid eval(), new Function(), and string-based setTimeout/setInterval code execution'
  },
  SECURITY_SENSITIVE_LOGGING: {
    pillar: PILLARS.PILLAR_9,
    severity: 'HIGH',
    needs: 'light',
    directive: 'Never log sensitive credentials, tokens, or passwords to console diagnostics'
  },

  // Pillar 10: Testing Discipline
  TEST_FAKE_GREEN: {
    pillar: PILLARS.PILLAR_10,
    severity: 'HIGH',
    needs: 'standard',
    directive: 'Replace trivial truthy assertions with genuine assertions testing real logic'
  },
  TEST_MISSING_COLOCATED: {
    pillar: PILLARS.PILLAR_10,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Co-locate *.spec.ts or *.test.ts alongside the molecule capsule'
  },

  // Pillar 11: Naming Conventions
  NAMING_BARE_BOOLEAN: {
    pillar: PILLARS.PILLAR_11,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Prefix boolean variables with is, has, can, or should'
  },
  NAMING_HANDLER_PREFIX: {
    pillar: PILLARS.PILLAR_11,
    severity: 'LOW',
    needs: 'light',
    directive: 'Prefix action handler functions with handle (e.g. handleCheckout)'
  },

  LINE_BUDGET_FILE: {
    pillar: PILLARS.PILLAR_1,
    severity: 'MEDIUM',
    needs: 'deep',
    directive: 'Decompose monolith into domain capsules and molecules'
  },
  LINE_BUDGET_MOLECULE: {
    pillar: PILLARS.PILLAR_1,
    severity: 'MEDIUM',
    needs: 'deep',
    directive: 'Split molecule into focused sub-molecules or extract state to hook'
  },
  VIEW_MONOLITH: {
    pillar: PILLARS.PILLAR_1,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Refactor top-level view to a 10 to 20 line Table of Contents'
  },
  CONTROL_FLOW_INLINE_BOOLEAN: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Compose booleans into Stage 1 concepts and Stage 2 decision variables'
  },
  CONTROL_FLOW_NESTED_TERNARY: {
    pillar: PILLARS.PILLAR_2,
    severity: 'CRITICAL',
    needs: 'light',
    directive: 'Extract display states into computed descriptor objects or early returns'
  },
  CONTROL_FLOW_DISPATCH_SWITCH: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Replace repetitive dispatch switch with an O(1) keyed dictionary or method map (Directive 3.E)'
  },
  CONTROL_FLOW_SILENT_GUARD: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Replace silent bare return in side-effecting logic with explicit ResultTuple, logger diagnostic, or error state (Directive 3.G)'
  },
  CONTROL_FLOW_CASCADE_GUARDS: {
    pillar: PILLARS.PILLAR_2,
    severity: 'LOW',
    needs: 'standard',
    directive: 'Extract cascading guard clauses (>= 3) into a dedicated domain validator function (Directive 3.H)'
  },
  ERROR_SWALLOWED_EXCEPTION: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Do not swallow caught exceptions silently; propagate, report, record error state, or annotate chemx-allow: best-effort <reason> (Directive 2.H)'
  },
  COMBINATOR_RAW_BOOLEAN: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Do not pass inline boolean expressions or raw booleans into logical combinators; use named predicates or thunks (Directive 3.A)'
  },
  HOOK_SATURATION: {
    pillar: PILLARS.PILLAR_3,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Extract related state and effects into dedicated domain hooks'
  },
  HOOK_RETURN_OVERLOAD: {
    pillar: PILLARS.PILLAR_3,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Limit hook return values to 3 to 5 properties (Deprecated: use HOOK_SHAPE_CONTRACT)'
  },
  HOOK_SHAPE_CONTRACT: {
    pillar: PILLARS.PILLAR_3,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Structure hook returns into flat State, Status, and verb-prefixed Actions buckets'
  },
  CONTROLLER_VIEW_MISMATCH: {
    pillar: PILLARS.PILLAR_3,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Ensure view destructuring matches properties returned by the co-located controller'
  },
  TIMER_DISCIPLINE: {
    pillar: PILLARS.PILLAR_6,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Wrap timers in self-cleaning hooks returning lifecycle cleanup disposers'
  },
  RENDER_HACK_TIMEOUT: {
    pillar: PILLARS.PILLAR_6,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Replace render-hack setTimeout(0) with await nextTick() or RAF'
  },
  LIFECYCLE_ORPHANED_LISTENER: {
    pillar: PILLARS.PILLAR_6,
    severity: 'HIGH',
    needs: 'standard',
    directive: 'Pair every addEventListener with removeEventListener, an AbortController signal, or once: true (Directive 6.D)'
  },
  TYPE_COLOCATION: {
    pillar: PILLARS.PILLAR_4,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Define co-located domain interfaces in types/*.d.ts'
  },
  SYNTHETIC_MOCK_DATA: {
    pillar: PILLARS.PILLAR_4,
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Use live API data or explicit empty states instead of mock placeholders'
  },
  DATA_FLOW_OPTIONAL_CHAINING_CHURN: {
    pillar: PILLARS.PILLAR_4,
    severity: 'LOW',
    needs: 'standard',
    directive: 'Level incoming data shapes at the boundary using sentinels or normalizeArray instead of deep optional chaining churn (Directive 2.I)'
  },
  RAW_INLINE_STYLE: {
    pillar: PILLARS.PILLAR_5,
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Decouple into Level 1 atom props, SCSS mixins, or scoped classes via @apply'
  },
  ICON_SVG_STYLE_LEAK: {
    pillar: PILLARS.PILLAR_5,
    severity: 'LOW',
    needs: 'light',
    directive: 'Avoid text-* utility classes on FontAwesome icons; use color prop or CSS'
  },
  TYPOGRAPHY_EM_DASH: {
    pillar: PILLARS.PILLAR_7,
    severity: 'LOW',
    needs: 'light',
    directive: 'Replace em dashes with hyphens or colons per typography standard'
  },
  UNGUARDED_LOGGING: {
    pillar: PILLARS.PILLAR_7,
    severity: 'LOW',
    needs: 'light',
    directive: 'Route runtime diagnostics through a production-silenced debug proxy'
  },
  SYNTAX_PARSE_ERROR: {
    pillar: PILLARS.PILLAR_1,
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Fix syntax errors before static analysis'
  },
  AI_SLOP_CONVERSATIONAL_ARTIFACT: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'CRITICAL',
    needs: 'light',
    directive: 'Remove LLM assistant conversational residue and markdown leaks from comments and code'
  },
  AI_SLOP_LAZY_PLACEHOLDER: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'CRITICAL',
    needs: 'standard',
    directive: 'Replace lazy AI truncation placeholders with complete, verifiable implementations'
  },
  AI_SLOP_SHALLOW_CATCH: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Replace shallow catch paranoia wrappers with intentional error propagation or ResultTuple'
  },
  AI_SLOP_UTILITY_REINVENTION: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'HIGH',
    needs: 'standard',
    directive: 'Import shared domain utilities instead of reinventing boilerplate helpers inline'
  },
  AI_SLOP_ECHO_COMMENT: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'MEDIUM',
    needs: 'light',
    directive: 'Eliminate trivial parroting comments that merely restate self-documenting code'
  },
  AI_SLOP_LAZY_ANY: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'MEDIUM',
    needs: 'standard',
    directive: 'Replace lazy any widening with strict domain types or unknown guards'
  },
  AI_SLOP_REDUNDANT_PASSTHROUGH: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'LOW',
    needs: 'light',
    directive: 'Inline redundant single-use passthrough assignments directly into return expressions'
  },

  // Greybeard Pragmatic: Structural Weight & Bounded Context
  STRUCTURAL_WEIGHT_EXCEEDED: {
    pillar: PILLARS.PILLAR_1,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Reduce component responsibility density: extract domain hooks, decompose branching, or flatten render tree'
  },
  COMPLEXITY_CYCLOMATIC_HIGH: {
    pillar: PILLARS.PILLAR_2,
    severity: 'HIGH',
    needs: 'standard',
    directive: 'Decompose high cyclomatic complexity into pure helper functions or table dispatch'
  },
  HOOK_STATE_SATURATION: {
    pillar: PILLARS.PILLAR_3,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Extract co-located state and effects into a dedicated domain hook or reducer'
  },
  RENDER_TREE_DEPTH_EXCEEDED: {
    pillar: PILLARS.PILLAR_2,
    severity: 'HIGH',
    needs: 'light',
    directive: 'Extract nested JSX ternaries into computed descriptor objects or early returns'
  },
  PROP_SURFACE_BLOAT: {
    pillar: PILLARS.PILLAR_4,
    severity: 'MEDIUM',
    needs: 'deep',
    directive: 'Encapsulate flat primitive props into a cohesive domain type or composable'
  },
  LAYER_VIOLATION_CONTROLLER: {
    pillar: PILLARS.PILLAR_4,
    severity: 'CRITICAL',
    needs: 'deep',
    directive: 'Do not inject DbContext or raw persistence into presentation controllers; route through MediatR/CQRS handlers'
  },
  COUPLING_EXCESSIVE_INJECTION: {
    pillar: PILLARS.PILLAR_1,
    severity: 'HIGH',
    needs: 'deep',
    directive: 'Decompose high-coupling controllers; reduce injected services or route via MediatR'
  }
};

/**
 * Capability tiers, lowest first. `needs` on a rule is the minimum capability its FIX
 * calls for (difficulty of the fix, not severity): light is a local mechanical rewrite,
 * standard needs a judgement about behaviour or data, deep is cross-file restructuring.
 */
export const NEEDS_TIERS = Object.freeze(['light', 'standard', 'deep']);
export const DEFAULT_NEEDS = 'standard';

/**
 * Rule ids emitted outside the audit engine (autofix suggestions, merge-conflict scan,
 * edit guardrails). They stay out of RULE_REGISTRY because registry membership is
 * ratcheted (RULESET_VERSION, fixtures); their tier is recorded here for triage.
 */
export const UNREGISTERED_RULE_NEEDS = Object.freeze({
  MACRO_TASK_OVER_MICRO_TASK: 'standard',
  UNMERGED_CONFLICT: 'standard',
  ZERO_RAW_DOM_MOLECULE: 'standard'
});

/** Minimum capability tier the fix for `rule` needs; unknown rules default to 'standard'. */
export const resolveRuleNeeds = (rule) => {
  const registered = RULE_REGISTRY[rule]?.needs;
  const supplemental = UNREGISTERED_RULE_NEEDS[rule];
  return registered ?? supplemental ?? DEFAULT_NEEDS;
};
