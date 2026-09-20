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

export const RULE_REGISTRY = {
  // Pillar 8: Accessibility & Semantic Integrity
  A11Y_CLICKABLE_NON_SEMANTIC: {
    pillar: PILLARS.PILLAR_8,
    severity: 'MEDIUM',
    directive: 'Replace clickable generic container with native interactive element (<button> or <a>)'
  },
  A11Y_IMAGE_MISSING_ALT: {
    pillar: PILLARS.PILLAR_8,
    severity: 'MEDIUM',
    directive: 'Provide meaningful alt text or alt="" for decorative images'
  },

  // Pillar 9: Security & Content Safety
  SECURITY_RAW_HTML_INJECTION: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    directive: 'Sanitize dynamic HTML via DOMPurify before injecting into v-html or dangerouslySetInnerHTML'
  },
  SECURITY_HARDCODED_SECRET: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    directive: 'Extract hardcoded API keys and secrets into environment variables or secrets manager'
  },
  SECURITY_REVERSE_TABNABBING: {
    pillar: PILLARS.PILLAR_9,
    severity: 'MEDIUM',
    directive: 'Add rel="noopener noreferrer" to external links with target="_blank" to prevent tab hijacking'
  },
  SECURITY_JAVASCRIPT_URL: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    directive: 'Do not use javascript: pseudo-protocol in links or action attributes; use event handlers'
  },
  SECURITY_DYNAMIC_CODE_EXECUTION: {
    pillar: PILLARS.PILLAR_9,
    severity: 'CRITICAL',
    directive: 'Avoid eval(), new Function(), and string-based setTimeout/setInterval code execution'
  },
  SECURITY_SENSITIVE_LOGGING: {
    pillar: PILLARS.PILLAR_9,
    severity: 'HIGH',
    directive: 'Never log sensitive credentials, tokens, or passwords to console diagnostics'
  },

  // Pillar 10: Testing Discipline
  TEST_FAKE_GREEN: {
    pillar: PILLARS.PILLAR_10,
    severity: 'HIGH',
    directive: 'Replace trivial truthy assertions with genuine assertions testing real logic'
  },
  TEST_MISSING_COLOCATED: {
    pillar: PILLARS.PILLAR_10,
    severity: 'MEDIUM',
    directive: 'Co-locate *.spec.ts or *.test.ts alongside the molecule capsule'
  },

  // Pillar 11: Naming Conventions
  NAMING_BARE_BOOLEAN: {
    pillar: PILLARS.PILLAR_11,
    severity: 'MEDIUM',
    directive: 'Prefix boolean variables with is, has, can, or should'
  },
  NAMING_HANDLER_PREFIX: {
    pillar: PILLARS.PILLAR_11,
    severity: 'LOW',
    directive: 'Prefix action handler functions with handle (e.g. handleCheckout)'
  },

  LINE_BUDGET_FILE: {
    pillar: PILLARS.PILLAR_1,
    severity: 'MEDIUM',
    directive: 'Decompose monolith into domain capsules and molecules'
  },
  LINE_BUDGET_MOLECULE: {
    pillar: PILLARS.PILLAR_1,
    severity: 'MEDIUM',
    directive: 'Split molecule into focused sub-molecules or extract state to hook'
  },
  VIEW_MONOLITH: {
    pillar: PILLARS.PILLAR_1,
    severity: 'HIGH',
    directive: 'Refactor top-level view to a 10 to 20 line Table of Contents'
  },
  CONTROL_FLOW_INLINE_BOOLEAN: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    directive: 'Compose booleans into Stage 1 concepts and Stage 2 decision variables'
  },
  CONTROL_FLOW_NESTED_TERNARY: {
    pillar: PILLARS.PILLAR_2,
    severity: 'CRITICAL',
    directive: 'Extract display states into computed descriptor objects or early returns'
  },
  CONTROL_FLOW_DISPATCH_SWITCH: {
    pillar: PILLARS.PILLAR_2,
    severity: 'MEDIUM',
    directive: 'Replace repetitive dispatch switch with an O(1) keyed dictionary or method map (Directive 3.E)'
  },
  HOOK_SATURATION: {
    pillar: PILLARS.PILLAR_3,
    severity: 'HIGH',
    directive: 'Extract related state and effects into dedicated domain hooks'
  },
  HOOK_RETURN_OVERLOAD: {
    pillar: PILLARS.PILLAR_3,
    severity: 'HIGH',
    directive: 'Limit hook return values to 3 to 5 properties (State + Status + Actions)'
  },
  CONTROLLER_VIEW_MISMATCH: {
    pillar: PILLARS.PILLAR_3,
    severity: 'CRITICAL',
    directive: 'Ensure view destructuring matches properties returned by the co-located controller'
  },
  TIMER_DISCIPLINE: {
    pillar: PILLARS.PILLAR_6,
    severity: 'CRITICAL',
    directive: 'Wrap timers in self-cleaning hooks returning lifecycle cleanup disposers'
  },
  RENDER_HACK_TIMEOUT: {
    pillar: PILLARS.PILLAR_6,
    severity: 'CRITICAL',
    directive: 'Replace render-hack setTimeout(0) with await nextTick() or RAF'
  },
  TYPE_COLOCATION: {
    pillar: PILLARS.PILLAR_4,
    severity: 'MEDIUM',
    directive: 'Define co-located domain interfaces in types/*.d.ts'
  },
  TYPE_MONOLITH: {
    pillar: PILLARS.PILLAR_4,
    severity: 'HIGH',
    directive: 'Decompose root type monolith into co-located capsule types'
  },
  SYNTHETIC_MOCK_DATA: {
    pillar: PILLARS.PILLAR_4,
    severity: 'MEDIUM',
    directive: 'Use live API data or explicit empty states instead of mock placeholders'
  },
  RAW_INLINE_STYLE: {
    pillar: PILLARS.PILLAR_5,
    severity: 'MEDIUM',
    directive: 'Decouple into Level 1 atom props, SCSS mixins, or scoped classes via @apply'
  },
  ICON_SVG_STYLE_LEAK: {
    pillar: PILLARS.PILLAR_5,
    severity: 'LOW',
    directive: 'Avoid text-* utility classes on FontAwesome icons; use color prop or CSS'
  },
  TYPOGRAPHY_EM_DASH: {
    pillar: PILLARS.PILLAR_7,
    severity: 'LOW',
    directive: 'Replace em dashes with hyphens or colons per typography standard'
  },
  UNGUARDED_LOGGING: {
    pillar: PILLARS.PILLAR_7,
    severity: 'LOW',
    directive: 'Route runtime diagnostics through a production-silenced debug proxy'
  },
  SYNTAX_PARSE_ERROR: {
    pillar: PILLARS.PILLAR_1,
    severity: 'CRITICAL',
    directive: 'Fix syntax errors before static analysis'
  },
  AI_SLOP_CONVERSATIONAL_ARTIFACT: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'CRITICAL',
    directive: 'Remove LLM assistant conversational residue and markdown leaks from comments and code'
  },
  AI_SLOP_LAZY_PLACEHOLDER: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'CRITICAL',
    directive: 'Replace lazy AI truncation placeholders with complete, verifiable implementations'
  },
  AI_SLOP_SHALLOW_CATCH: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'HIGH',
    directive: 'Replace shallow catch paranoia wrappers with intentional error propagation or ResultTuple'
  },
  AI_SLOP_UTILITY_REINVENTION: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'HIGH',
    directive: 'Import shared domain utilities instead of reinventing boilerplate helpers inline'
  },
  AI_SLOP_ECHO_COMMENT: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'MEDIUM',
    directive: 'Eliminate trivial parroting comments that merely restate self-documenting code'
  },
  AI_SLOP_LAZY_ANY: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'MEDIUM',
    directive: 'Replace lazy any widening with strict domain types or unknown guards'
  },
  AI_SLOP_REDUNDANT_PASSTHROUGH: {
    pillar: 'AI Slop & Code Authenticity',
    severity: 'LOW',
    directive: 'Inline redundant single-use passthrough assignments directly into return expressions'
  }
};
