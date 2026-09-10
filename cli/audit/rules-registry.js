export const PILLARS = {
  PILLAR_1: 'Line Budgets & Monolith Decomposition',
  PILLAR_2: 'Control Flow & Boolean Logic',
  PILLAR_3: 'Reactivity & Composable Contracts',
  PILLAR_4: 'Type Architecture & Data Integrity',
  PILLAR_5: 'Design System & Styling Hygiene',
  PILLAR_6: 'Timers & Macro-Task Discipline',
  PILLAR_7: 'Global Hygiene & Typography'
};

export const RULE_REGISTRY = {
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
    directive: 'Use atom props, SCSS mixins, or CSS custom properties instead of inline styles'
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
  }
};
