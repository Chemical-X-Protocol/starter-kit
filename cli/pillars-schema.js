/**
 * Chemical X Protocol: Canonical 7 Architectural Pillars Registry
 * Pillar selection drives .chemx/config.json and the host shims; AGENTS.md holds the rules.
 */

export const PILLARS = [
  {
    id: 'p1_line_budgets',
    key: 'lineBudgets',
    title: 'Pillar 1: Molecular Line Budgets',
    summary: 'Structural weight budgets for files and molecule capsules, as set in AGENTS.md.'
  },
  {
    id: 'p2_zero_raw_dom',
    key: 'zeroRawDom',
    title: 'Pillar 2: Strict Component Tiers & Zero-Raw-DOM',
    summary: 'Raw DOM elements permitted only in atoms; molecules compose atoms.'
  },
  {
    id: 'p3_toc_views',
    key: 'tableOfContentsViews',
    title: 'Pillar 3: Table-of-Contents Views',
    summary: 'Declarative 10 to 20 line view templates assembling molecules.'
  },
  {
    id: 'p4_composables',
    key: 'composableContracts',
    title: 'Pillar 4: Molecular Composable Contracts',
    summary: 'Classified return shape (State, Status, flat verb-prefixed Actions), safe destructuring, auto-cleanup.'
  },
  {
    id: 'p5_verification_first',
    key: 'verificationFirst',
    title: 'Pillar 5: Silent Verification Pipeline',
    summary: 'Silent AST check, typecheck, and test tools before terminal commands.'
  },
  {
    id: 'p6_ast_query_machine',
    key: 'astQueryFirst',
    title: 'Pillar 6: AST Codebase Query Engine',
    summary: 'Symbol-targeted reading and SQLite index before broad file dumps.'
  },
  {
    id: 'p7_swarm_backlog',
    key: 'swarmBacklog',
    title: 'Pillar 7: Swarm Task Backlog & Cost Tracking',
    summary: 'SQLite-backed task queue, file locks, and token accounting.'
  }
];

export const PILLAR_PRESETS = {
  recommended: {
    id: 'recommended',
    name: 'Recommended / Balanced',
    description: 'Core architectural standards (Line budgets, Tiers, TOC views, Composables, AST Query)',
    pillars: ['p1_line_budgets', 'p2_zero_raw_dom', 'p3_toc_views', 'p4_composables', 'p6_ast_query_machine']
  },
  strict: {
    id: 'strict',
    name: 'Strict Chemical X',
    description: 'All 7 Canonical Pillars including verification pipeline and swarm backlog',
    pillars: ['p1_line_budgets', 'p2_zero_raw_dom', 'p3_toc_views', 'p4_composables', 'p5_verification_first', 'p6_ast_query_machine', 'p7_swarm_backlog']
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Line budgets only, no agent prohibitions or tier restrictions',
    pillars: ['p1_line_budgets']
  },
  none: {
    id: 'none',
    name: 'None',
    description: 'Do not install any agent steering files',
    pillars: []
  }
};
