import type { SystemLayer } from './funnel-system-layers.types';

export const CORE_SYSTEM_LAYERS: readonly SystemLayer[] = [
  {
    id: 'architecture',
    number: 1,
    name: 'Architecture Layer',
    role: 'The 7 Molecular Pillars',
    badgeText: 'FOUNDATION',
    tone: 'sky',
    icon: 'i-lucide-layers',
    thesis: 'Software shaped like small, independently understandable molecules rather than giant monoliths.',
    description: 'Enforces hard file bounds (<500 LOC), capsules (<100 LOC), TOC views (<20 LOC), and 2-stage atomic booleans.',
    agentImpact: 'Narrows the working context an agent holds in memory, eliminating hallucinated state mutations.',
    headlineCommand: '7 Pillars Specification • .cursorrules • AGENTS.md',
    keyMechanisms: ['< 500 LOC file ceiling (< 100 LOC capsules)', '< 20 LOC top-level TOC views', 'Two-stage atomic booleans with early guards', 'Composables returning 3-5 properties max', '[data, error] = await toResult(...) tuples']
  },
  {
    id: 'measurement',
    number: 2,
    name: 'Measurement & Audit Layer',
    role: 'AST Static Analysis & Scorecards',
    badgeText: 'ENFORCEMENT',
    tone: 'lime',
    icon: 'i-lucide-shield-check',
    thesis: 'Mechanically verifiable code quality with zero cloud upload.',
    description: 'Runs local AST checks in under 5 seconds to detect line count creep, hook saturation, and context token hazards.',
    agentImpact: 'Provides deterministic mathematical feedback on codebase health (MHI Score) before context rot propagates to models.',
    headlineCommand: 'npx chemx audit --strict',
    keyMechanisms: ['Free zero-install CLI execution (no cloud code upload)', 'Modular Health Index (MHI) grade calculation', 'Token burn & excess prompt tax estimation', 'Shareable scorecards via npx chemx audit --share', 'Strict pre-commit gatekeeper blocking files > 500 LOC']
  },
  {
    id: 'agent-interface',
    number: 3,
    name: 'Agent Interface Layer',
    role: 'Deterministic MCP Server',
    badgeText: 'INTEGRATION',
    tone: 'pink',
    icon: 'i-lucide-cpu',
    thesis: 'Direct protocol connection between IDE agents and AST enforcement.',
    description: 'The official Model Context Protocol server connects Claude, Gemini, Antigravity, and Cursor to architectural tools.',
    agentImpact: 'Agents verify syntax, typecheck correctness, and run test suites in-process through a single master gateway permission.',
    headlineCommand: 'pnpm chemx:mcp',
    keyMechanisms: ['chemx master gateway dispatching in-process', 'In-loop AST verification, typechecks, and tests', 'Refactoring prompt synthesis for Cursor/Windsurf', 'Multi-agent team coordination primitives & locks']
  },
  {
    id: 'observation',
    number: 4,
    name: 'Observation & Query Layer',
    role: 'AST Codebase Fingerprinting',
    badgeText: 'OBSERVATION',
    tone: 'sky',
    icon: 'i-lucide-search',
    thesis: 'Surgical code inspection without inhaling thousands of lines of irrelevant context.',
    description: 'Discovers duplicated predicates, shared state machines, and parallel controllers before modifying code.',
    agentImpact: 'Supplies exact semantic AST slices instead of raw file dumps, preventing context window saturation.',
    headlineCommand: 'pnpm chemx query',
    keyMechanisms: ['AST pattern matching across component trees', 'Duplicate boolean predicates and logic fork detection', 'Composable dependency graph & return property auditing', 'Fast CLI query interface via chemx q / chemx search']
  }
];
