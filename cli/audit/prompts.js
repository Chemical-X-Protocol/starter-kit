import { groupViolationsByRule, buildPathTree } from './reporter-grouping.js';
import {
  CYAN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET
} from './reporter-utils.js';

const SEVERITY_COLORS = {
  CRITICAL: RED,
  HIGH: ORANGE,
  MEDIUM: YELLOW,
  LOW: DIM
};

const renderTreeLines = (node, depth = 0) => {
  const lines = [];
  const indent = '   ' + '  '.repeat(depth);

  const sortedDirs = Array.from(node.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dirName, childNode] of sortedDirs) {
    lines.push(`${indent}📁 ${BOLD}${dirName}${RESET}`);
    const childLines = renderTreeLines(childNode, depth + 1);
    lines.push(...childLines);
  }

  const sortedFiles = Array.from(node.files.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [fileName, locs] of sortedFiles) {
    const uniqueLocs = Array.from(new Set(locs)).join(', ');
    lines.push(`${indent}- \`${YELLOW}${fileName}:${uniqueLocs}${RESET}\``);
  }

  return lines;
};

export const formatGroupedPromptViolations = (violations = []) => {
  const hasNoViolations = violations.length === 0;
  if (hasNoViolations) return [];

  const ruleGroups = groupViolationsByRule(violations);
  const lines = [];

  ruleGroups.forEach((rg, idx) => {
    const sevColor = SEVERITY_COLORS[rg.severity] || YELLOW;
    const countLabel = rg.total === 1 ? '1 item' : `${rg.total} items`;
    lines.push(`${idx + 1}. ${sevColor}[${rg.rule}]${RESET} ${BOLD}(${countLabel})${RESET}`);
    lines.push(`   Hazard:    ${rg.hazard}`);
    lines.push(`   Directive: ${CYAN}${rg.directive}${RESET}`);
    lines.push('   Locations:');

    const tree = buildPathTree(rg.violations);
    const treeLines = renderTreeLines(tree, 0);
    lines.push(...treeLines);
    lines.push('');
  });

  return lines;
};

export const buildGradeFPrompt = (report, options = {}) => {
  const { excludeAiSlop = false } = options;
  const { violations = [], hotspots = [] } = report;
  const critical = violations
    .filter((v) => v.severity === 'CRITICAL')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000);

  const hasNoCritical = critical.length === 0;
  const hasNoMonoliths = extremeMonoliths.length === 0;
  if (hasNoCritical && hasNoMonoliths) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:\n');

  if (extremeMonoliths.length > 0) {
    lines.push('### EXTREME MONOLITHS (>= 2,000 lines of code) : MONOLITH DECOMPOSITION');
    lines.push('Action: Decompose into crystalline single-responsibility capsules (< 100 lines per molecule). Convert top-level view into a declarative Table-of-Contents view.\n');
    extremeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  if (critical.length > 0) {
    lines.push('### CRITICAL AST VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(critical));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Pre-Split Pattern Discovery: Survey cross-file patterns before slicing; extract canonical shared capsules first to avoid proliferating duplicate one-off patterns.');
  lines.push('2. Every new molecule component must stay under 100 lines.');
  lines.push('3. Top-level page views must be 10-20 line declarative Table-of-Contents templates assembling components via named slots.');
  lines.push('4. Zero synthetic or mock data: return live data or explicit empty states.');
  lines.push('5. Zero render-hack setTimeout: replace with await nextTick() or flush: post.');
  lines.push('6. Output surgical diffs or modular replacements. Preserve existing external exports.');

  return lines.join('\n');
};

export const buildGradeDPrompt = (report, options = {}) => {
  const { excludeAiSlop = false } = options;
  const { violations = [], hotspots = [] } = report;
  const high = violations
    .filter((v) => v.severity === 'HIGH')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000);

  const hasNoHigh = high.length === 0;
  const hasNoMonoliths = severeMonoliths.length === 0;
  if (hasNoHigh && hasNoMonoliths) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Refactor the following Grade D High-Severity Architectural Debts according to Chemical X Molecular Architecture Standards:\n');

  if (severeMonoliths.length > 0) {
    lines.push('### SEVERE MONOLITHS (1,000 - 1,999 lines of code)');
    lines.push('Action: Extract sub-features into isolated molecule capsules (< 100 lines of code) and domain composables.\n');
    severeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  if (high.length > 0) {
    lines.push('### HIGH SEVERITY VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(high));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Hook Saturation: Extract component hooks into dedicated domain composables adhering to the 3-5 property return limit (State + Status + Actions).');
  lines.push('2. Complex Control Flow: Break multi-clause conditionals into 2-stage atomic boolean variables with early-return guard clauses.');
  lines.push('3. Zero breaking changes to caller APIs or existing props.');

  return lines.join('\n');
};

export const buildGradeCPrompt = (report, options = {}) => {
  const { excludeAiSlop = false } = options;
  const { violations = [], hotspots = [] } = report;
  const medium = violations
    .filter((v) => v.severity === 'MEDIUM')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000);

  const hasNoMedium = medium.length === 0;
  const hasNoMonoliths = warningMonoliths.length === 0;
  if (hasNoMedium && hasNoMonoliths) return '';

  const lines = [];
  lines.push('Act as a Senior Frontend Engineer. Refactor the following Grade C Medium-Severity Technical Debts according to Chemical X Molecular Architecture Standards:\n');

  if (warningMonoliths.length > 0) {
    lines.push('### WARNING MONOLITHS (500 - 999 lines of code)');
    lines.push('Action: Bring file under 500 line budget by extracting helper functions, types, and child molecules.\n');
    warningMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('### MEDIUM SEVERITY VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(medium));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Zero raw inline styles: Replace style={{...}} with atom props, SCSS mixins (@include glass), or scoped BEM classes.');
  lines.push('2. Extract anonymous inline callbacks into named functions before passing as props.');
  lines.push('3. Co-locate granular types (*.d.ts) inside feature capsules (< 100 lines of code). Avoid type monoliths.');

  return lines.join('\n');
};

export const buildGradeBPrompt = (report, options = {}) => {
  const { excludeAiSlop = false } = options;
  const { violations = [] } = report;
  const low = violations
    .filter((v) => v.severity === 'LOW')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));

  const hasNoLow = low.length === 0;
  if (hasNoLow) return '';

  const lines = [];
  lines.push('Act as a Clean Code Specialist. Clean up the following Grade B Low-Severity Hygiene Issues according to Chemical X standards:\n');

  lines.push('### LOW HYGIENE VIOLATIONS');
  lines.push(...formatGroupedPromptViolations(low));

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Typography Hygiene: Replace all em dashes with standard hyphens (-) or colons (:).');
  lines.push('2. Logging Hygiene: Remove unguarded console.log calls or route through central debug proxy.');
  lines.push('3. FontAwesome Compliance: Remove text-* utility classes from icons; use :color prop or inline CSS.');

  return lines.join('\n');
};

export const buildAiSlopPrompt = (report) => {
  const { violations = [] } = report;
  const slopViolations = violations.filter((v) => Boolean(v.isAiSlop));

  const hasNoSlop = slopViolations.length === 0;
  if (hasNoSlop) return '';

  const lines = [];
  lines.push('Act as a Clean Code Specialist and Code Authenticity Guardian. Eliminate the following AI Slop and conversational artifacts from our codebase according to Chemical X standards:\n');

  lines.push('### AI SLOP & CODE AUTHENTICITY VIOLATIONS');
  lines.push(...formatGroupedPromptViolations(slopViolations));

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Conversational Residue: Completely remove leaked AI conversational preambles, assistant markdown code fences, and pleasantry comments.');
  lines.push('2. Truncation Placeholders: Replace lazy AI truncation placeholders with complete, robust, and verifiable implementations.');
  lines.push('3. Echo Comments: Delete trivial parroting comments that merely restate adjacent self-documenting code.');
  lines.push('4. Paranoia Catch Wrappers: Replace shallow or empty catch blocks with intentional error propagation or ResultTuple ([data, error]).');
  lines.push('5. Inline Utility Reinventions: Replace reinvented inline helper utilities with shared project utilities or native methods.');
  lines.push('6. Type Widening: Eliminate lazy "any" type casts on error parameters or variables; enforce strict typing.');

  return lines.join('\n');
};

export const buildHotspotsPrompt = (report) => {
  const { hotspots = [] } = report;
  const monolithHotspots = hotspots.filter((h) => h.isMonolith || h.lineCount > 500);

  const hasNoMonoliths = monolithHotspots.length === 0;
  if (hasNoMonoliths) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Surgically decompose the following monolithic hotspot files according to Chemical X Molecular Architecture Standards:\n');

  lines.push('### MONOLITHIC REFACTORING HOTSPOTS');
  lines.push('Action: Decompose into single-responsibility crystalline molecule capsules (< 100 lines) and dedicated domain composables.\n');
  monolithHotspots.forEach((h, i) => {
    const tier = h.monolithTier ? `[${h.monolithTier} MONOLITH]` : '[MONOLITH]';
    lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines, ${h.violationCount} hazards) ${tier}`);
  });
  lines.push('');

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Branch First: Change to a new branch prefixed with `chem-x/NAMEOFIMPROVEMENT` before making changes, then commit the branch and create a PR to main.');
  lines.push('2. Pre-Split Pattern Discovery: Audit recurring UI layouts, state machines, and predicates across monoliths first; extract canonical shared capsules before slicing to prevent bespoke pattern duplication.');
  lines.push('3. Molecular Limits: Molecule capsules must strictly remain under 100 lines per file.');
  lines.push('4. Table-of-Contents Views: Top-level page views must be 10 to 20 line declarative Table of Contents assembling molecules via named slots.');
  lines.push('5. Composable Return Contracts: Custom hooks/composables must strictly limit returns to 3 to 5 properties (State + Status + Actions).');
  lines.push('6. Type Co-location: Co-locate granular types/*.d.ts files inside each feature capsule (< 100 lines per type file) instead of creating type monoliths.');
  lines.push('7. Zero breaking changes to external component APIs, route exports, or existing props.');

  return lines.join('\n');
};

export const buildMasterPrompt = (report) => {
  const sections = [
    buildGradeFPrompt(report, { excludeAiSlop: true }),
    buildGradeDPrompt(report, { excludeAiSlop: true }),
    buildGradeCPrompt(report, { excludeAiSlop: true }),
    buildGradeBPrompt(report, { excludeAiSlop: true }),
    buildAiSlopPrompt(report),
    buildHotspotsPrompt(report)
  ].filter(Boolean);

  const hasNoSections = sections.length === 0;
  if (hasNoSections) return '';

  const header = `Act as a Principal Systems Architect. Execute a phased architectural refactoring of our codebase according to Chemical X Molecular Architecture Standards.\n\n`;
  return header + sections.join('\n\n---\n\n');
};

export const formatPromptBox = (title, promptText) => {
  if (!promptText) return '';

  const lines = [];
  lines.push(`\n   ${CYAN}┌────────────────────────────────────────────────────────────────────────┐${RESET}`);
  lines.push(`   ${CYAN}│${RESET} ${BOLD}${title}${RESET}`);
  lines.push(`   ${CYAN}│${RESET} ${DIM}Copy and paste the block below directly into Cursor / Claude / Windsurf:${RESET}`);
  lines.push(`   ${CYAN}├────────────────────────────────────────────────────────────────────────┤${RESET}`);

  const promptLines = promptText.split('\n');
  for (const pl of promptLines) {
    lines.push(`   ${CYAN}│${RESET} ${pl}`);
  }

  lines.push(`   ${CYAN}└────────────────────────────────────────────────────────────────────────┘${RESET}\n`);
  return lines.join('\n');
};
