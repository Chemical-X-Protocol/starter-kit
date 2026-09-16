/**
 * Chemical X Protocol: Self-Healing Remediation Roadmap
 * Calculates and formats the optimal sequence of architectural fixes.
 */

import {
  CYAN,
  GREEN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET,
  resolveTopSectionColor,
  groupViolationsBySeverity
} from './reporter-utils.js';

export const buildRemediationRoadmap = (report) => {
  const { hotspots = [], violations = [], patterns = [] } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);

  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000);
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000);
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000);

  const phases = [];

  // Phase 1: Pattern Recognition & Canonical Harvesting
  phases.push({
    step: 1,
    phase: 'PHASE 1: PATTERN HARVESTING & CANONICAL EXTRACTION',
    roi: 'MAXIMUM (Compounding Reuse)',
    rationale: 'Extract reusable UI structures and shared domain types before slicing monoliths to eliminate redundant bespoke code.',
    items: patterns.length > 0
      ? patterns.map((p) => ({
          title: p.label,
          target: p.suggestedCapsule,
          action: p.recommendation,
          locations: p.occurrences.slice(0, 3).map((o) => `${o.filePath}:${o.line}`)
        }))
      : [
          {
            title: 'Cross-Monolith Pattern Survey',
            target: 'src/components/molecules/',
            action: 'Audit shared card layouts, common status unions, and repeated filter predicates across candidate files before code splitting.',
            locations: []
          }
        ]
  });

  // Phase 2: Domain Foundations & Type Architecture
  const typeViolations = violations.filter((v) => v.rule === 'TYPE_MONOLITH' || v.pillar?.includes('Pillar 4'));
  phases.push({
    step: 2,
    phase: 'PHASE 2: DOMAIN FOUNDATIONS & TYPE INTEGRITY',
    roi: 'HIGH (Compile-Time Guardrails)',
    rationale: 'Co-locate granular types/*.d.ts capsules to provide strict discriminated unions for decomposing components.',
    items: typeViolations.length > 0
      ? typeViolations.slice(0, 5).map((v) => ({
          title: v.hazard,
          target: `${v.filePath} -> types/*.d.ts`,
          action: v.directive,
          locations: [`${v.filePath}:${v.line}`]
        }))
      : [
          {
            title: 'Domain Type Co-location',
            target: 'types/*.d.ts',
            action: 'Ensure molecule capsules own co-located type declarations (< 100 lines each) with zero root type dumping.',
            locations: []
          }
        ]
  });

  // Phase 3: Monolith Decomposition (Grade F & D)
  const topMonoliths = [...extremeMonoliths, ...severeMonoliths, ...warningMonoliths].slice(0, 6);
  phases.push({
    step: 3,
    phase: 'PHASE 3: MONOLITH DECOMPOSITION (HOTSPOTS)',
    roi: 'VERY HIGH (Context Window Unlocking)',
    rationale: 'Decompose giant views into 10-20 line Table-of-Contents templates by importing canonical capsules harvested in Phase 1.',
    items: topMonoliths.map((m) => ({
      title: `${m.filePath} (${m.lineCount} lines, ${m.violationCount} hazards)`,
      target: m.filePath,
      action: 'Decompose into crystalline single-responsibility capsules (< 100 lines per molecule) reusing Phase 1 components.',
      locations: [`${m.filePath}:1`]
    }))
  });

  // Phase 4: Component Hygiene & Polish (Grade C & B)
  phases.push({
    step: 4,
    phase: 'PHASE 4: COMPONENT HYGIENE & DESIGN SYSTEM POLISH',
    roi: 'MEDIUM (Visual & Syntax Standardization)',
    rationale: 'Clean up inline styles into mixins (@include glass), two-stage booleans, typography, and logging on the newly lean capsules.',
    items: [
      {
        title: `Medium Severity Debts (${medium.length} items)`,
        target: 'Component stylesheets & logic',
        action: 'Replace raw inline styles with atom props or SCSS mixins (@include glass); extract anonymous callbacks into named handlers.',
        locations: []
      },
      {
        title: `Hygiene & Typography Debts (${low.length} items)`,
        target: 'Copy, comments & logs',
        action: 'Eliminate em dashes (use hyphens or colons), route console logs through debug proxy, and ensure FontAwesome SVG compliance.',
        locations: []
      }
    ]
  });

  // Phase 5: Verification & Gatekeeping
  phases.push({
    step: 5,
    phase: 'PHASE 5: AUTOMATED GATEKEEPING & CI ENFORCEMENT',
    roi: 'PERMANENT (Zero-Entropy Protection)',
    rationale: 'Verify the newly refactored codebase passes with Grade A / Score >= 90 and install pre-commit guardrails.',
    items: [
      {
        title: 'Run Architectural Re-Audit',
        target: 'chemx audit',
        action: 'Execute npx chemx audit --strict to confirm zero monolith hazards remain.',
        locations: []
      },
      {
        title: 'Install Pre-Commit & CI Gatekeepers',
        target: '.git/hooks/pre-commit & .github/workflows/',
        action: 'Run npx chemx install to lock in line budgets and prevent future monolith regressions.',
        locations: []
      }
    ]
  });

  return phases;
};

export const formatRoadmapSection = (report, themeColor = null) => {
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const phases = buildRemediationRoadmap(report);
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   SELF-HEALING REMEDIATION ROADMAP (OPTIMAL FIX SEQUENCE)${RESET}`);
  lines.push(`${DIM}   Fix in this sequence to harvest patterns first and compound code reuse${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);

  phases.forEach((p) => {
    lines.push(`\n   ${CYAN}${BOLD}[STEP ${p.step}] ${p.phase}${RESET}`);
    lines.push(`   ${DIM}ROI: ${p.roi}${RESET}`);
    lines.push(`   ${YELLOW}Strategy: ${p.rationale}${RESET}`);

    p.items.forEach((item, idx) => {
      lines.push(`     ${idx + 1}. ${BOLD}${item.title}${RESET}`);
      lines.push(`        Target: ${CYAN}${item.target}${RESET}`);
      lines.push(`        Action: ${item.action}`);
      if (item.locations.length > 0) {
        lines.push(`        Locations: ${DIM}${item.locations.join(', ')}${RESET}`);
      }
    });
  });

  lines.push(`\n${sectionColor}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatRoadmapMarkdown = (report) => {
  const phases = buildRemediationRoadmap(report);
  const lines = [];

  lines.push('## 🗺 Recommended Remediation Sequence (Self-Healing Roadmap)\n');
  lines.push('> Follow this sequence strictly: harvesting patterns first creates reusable building blocks that eliminate duplicate work during subsequent monolith slicing.\n');

  phases.forEach((p) => {
    lines.push(`### Step ${p.step}: ${p.phase}`);
    lines.push(`**ROI**: ${p.roi} | **Strategy**: ${p.rationale}\n`);

    p.items.forEach((item) => {
      lines.push(`- [ ] **${item.title}**`);
      lines.push(`  - **Target**: \`${item.target}\``);
      lines.push(`  - **Action**: ${item.action}`);
      if (item.locations.length > 0) {
        lines.push(`  - **Locations**: \`${item.locations.join('`, `')}\``);
      }
    });
    lines.push('');
  });

  return lines.join('\n');
};

export const buildSelfHealingRoadmapPrompt = (report) => {
  const phases = buildRemediationRoadmap(report);
  const lines = [];

  lines.push('Act as a Principal Systems Architect. Execute a self-healing architectural remediation of our codebase by following this strict multi-phase sequence in order:\n');

  lines.push('### AI AGENT DISCOVERY & REFACTORING COMMANDS:');
  lines.push('- Discovery & Inspect: Run `pnpm q "<target>" --inspect` (or `npx chemx search "<target>" --inspect`) to inspect component props and hooks before editing.');
  lines.push('- Tier Filter: Run `pnpm q "<query>" --tier=molecule` (or `atom`, `organism`, `hook`) to find related capsules.');
  lines.push('- Zero-Overhead JSON: Run `pnpm q "<query>" --json` for minified AST metadata without burning context tokens on whole files.');
  lines.push('- Re-Verify Score: Run `npx chemx audit` after completing each phase to verify health score improvements.\n');

  phases.forEach((p) => {
    lines.push(`### STEP ${p.step}: ${p.phase}`);
    lines.push(`Goal: ${p.rationale}\n`);
    p.items.forEach((item, idx) => {
      lines.push(`${idx + 1}. Task: ${item.title}`);
      lines.push(`   Target: ${item.target}`);
      lines.push(`   Execution: ${item.action}`);
      if (item.locations.length > 0) {
        lines.push(`   Files: ${item.locations.join(', ')}`);
      }
      const rawTarget = item.target.split(' ')[0].replace(/->.*/, '').trim();
      if (rawTarget && !rawTarget.includes('*')) {
        lines.push(`   Command: pnpm q "${rawTarget}" --inspect`);
      }
    });
    lines.push('');
  });

  lines.push('### EXECUTION DISCIPLINE:');
  lines.push('1. Complete Step 1 (Pattern Harvesting) completely before touching any monolithic file in Step 3.');
  lines.push('2. Spliced views in Step 3 must directly import and bind to the canonical capsules created in Step 1.');
  lines.push('3. Every new molecule component must stay under 100 lines.');
  lines.push('4. Top-level page views must be 10-20 line declarative Table-of-Contents templates assembling molecules via named slots.');
  lines.push('5. Zero synthetic or mock data; zero em dashes (use hyphens or colons).');

  return lines.join('\n');
};
