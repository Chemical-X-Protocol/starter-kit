/**
 * Chemical X Protocol: Canonical 7 Architectural Pillars Registry
 * Modular directives for conscious agent steering and project configuration.
 */

export const PILLARS = [
  {
    id: 'p1_line_budgets',
    key: 'lineBudgets',
    title: 'Pillar 1: Molecular Line Budgets',
    summary: '100 LOC molecule outer bound, 500 LOC max file budget.',
    cursorRule: 'Strictly follow 100 LOC limit for molecule capsules and 500 LOC max file budget.',
    agentsDirective: `### Pillar 1: Molecular Line Budgets
- File Line Limit: 100 lines is an outer bound for molecules. Single-purpose files typically land well under this limit.
- Decompose on Seams: Split when you can name the new unit's single responsibility, not just when a line count is reached.
- Small single-purpose files reduce token scan overhead and context exhaustion.`
  },
  {
    id: 'p2_zero_raw_dom',
    key: 'zeroRawDom',
    title: 'Pillar 2: Strict Component Tiers & Zero-Raw-DOM',
    summary: 'Raw DOM elements permitted only in atoms; molecules compose atoms.',
    cursorRule: 'Zero-Raw-DOM in molecules: encapsulate raw <button>, <input>, etc. into foundational atoms.',
    agentsDirective: `### Pillar 2: Strict Component Tiers & Zero-Raw-DOM
- Atoms / Foundations: The only tier where raw DOM/HTML elements (<button>, <input>, <textarea>) are permitted.
- Molecules / Blocks: Groups of foundational elements. Zero raw DOM elements allowed.
- Organisms / Modules: Complex groupings of molecules and atoms. Zero raw DOM elements allowed.`
  },
  {
    id: 'p3_toc_views',
    key: 'tableOfContentsViews',
    title: 'Pillar 3: Table-of-Contents Views',
    summary: 'Declarative 10 to 20 line view templates assembling molecules.',
    cursorRule: 'Views must be clean 10-20 line declarative Table of Contents assembling molecules.',
    agentsDirective: `### Pillar 3: Table-of-Contents Views
- Top-level page views must never contain hundreds of lines of nested DOM scaffolding.
- A view template must read like a clean, 10 to 20 line declarative Table of Contents assembling self-contained molecules and organisms.`
  },
  {
    id: 'p4_composables',
    key: 'composableContracts',
    title: 'Pillar 4: Molecular Composable Contracts',
    summary: '3 to 5 return properties max, safe destructuring, auto-cleanup.',
    cursorRule: 'Composables: return plain objects with refs, strictly 3-5 properties max, auto-cleanup on unmount.',
    agentsDirective: `### Pillar 4: Molecular Composable Contracts
- Safe Destructuring: Return plain objects containing individual refs, computeds, and pure functions. Never return raw reactive objects.
- Return Limit: Strictly limit returns to State + Status + Actions (3 to 5 return properties maximum).
- Lifecycle Teardown: Clean up listeners, timers, and observers automatically on scope disposal.`
  },
  {
    id: 'p5_verification_first',
    key: 'verificationFirst',
    title: 'Pillar 5: Silent Verification Pipeline',
    summary: 'Silent AST check, typecheck, and test tools before terminal commands.',
    cursorRule: 'Use "npx chemx verify", "chemx test", or MCP tools to suppress compiler noise and conserve tokens.',
    agentsDirective: `### Pillar 5: Silent Verification Pipeline
- Verification-First: AI agents should leverage dedicated Chemical X MCP tools or CLI wrappers ('npx chemx verify', 'chemx test', 'chemx typecheck') before running terminal commands.
- Token Conservation: Silent verification suppresses passing checkmarks and compiler noise, returning structured diffs only when errors occur.`
  },
  {
    id: 'p6_ast_query_machine',
    key: 'astQueryFirst',
    title: 'Pillar 6: AST Codebase Query Engine',
    summary: 'Symbol-targeted reading and SQLite index before broad file dumps.',
    cursorRule: 'Search-First: Use "pnpm q <query>" or chemx read --symbol before broad grep/cat scans.',
    agentsDirective: `### Pillar 6: AST Codebase Query Engine
- Search-First Rule: Query the SQLite index ('pnpm q "<query>"' or MCP chemx_q) before running broad directory grep or find scans.
- Targeted Symbol Extraction: Extract only specific symbol declarations ('chemx read --symbol=<name>') rather than dumping full source files into context.`
  },
  {
    id: 'p7_swarm_backlog',
    key: 'swarmBacklog',
    title: 'Pillar 7: Swarm Task Backlog & Cost Tracking',
    summary: 'SQLite-backed task queue, file locks, and token accounting.',
    cursorRule: 'Coordinate multi-agent work via "chemx team task" and track token costs in SQLite.',
    agentsDirective: `### Pillar 7: Swarm Task Backlog & Cost Tracking
- Database Source of Truth: Record task assignments, status changes, and file locks directly in .chemx/index.db rather than giant markdown files.
- Token Cost Accounting: Record prompt tokens and dollar costs upon task completion for transparent ROI evaluation.`
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

export const buildCustomAgentsMd = (selectedPillarIds = [], options = {}) => {
  const activePillars = PILLARS.filter((p) => selectedPillarIds.includes(p.id) || selectedPillarIds.includes(p.key));
  const projectName = options.projectName || 'Project App';

  const sections = [
    `# Chemical X Molecular Architecture Directives`,
    `# Target Project: ${projectName}`,
    '',
    `> NOTE: This file is a project configuration generated from your selected Chemical X pillars.`,
    `> Review and customize these guidelines to match your team's specific workflow.`,
    ''
  ];

  if (activePillars.length === 0) {
    sections.push('No architectural pillars currently configured.');
    return sections.join('\n') + '\n';
  }

  sections.push('## Active Architectural Directives\n');
  for (const pillar of activePillars) {
    sections.push(pillar.agentsDirective);
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
};

export const buildCustomCursorRules = (selectedPillarIds = []) => {
  const activePillars = PILLARS.filter((p) => selectedPillarIds.includes(p.id) || selectedPillarIds.includes(p.key));

  const lines = [
    '# Chemical X Architecture Directives',
    '# Generated from selected project pillars. Review and modify as needed.',
    ''
  ];

  for (const pillar of activePillars) {
    lines.push(pillar.cursorRule);
  }

  return lines.join('\n').trim() + '\n';
};
