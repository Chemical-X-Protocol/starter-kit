import { describeLineBudgetPolicy } from '../config/profiles.js';
import { SIZE_LABELS, hasSizeClass, isMonolithHotspot } from './line-budgets.js';
import { groupViolationsByRule, buildPathTree } from './reporter-grouping.js';
import { buildNeedsLine, buildActionLine } from './prompt-rule-lines.js';
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

export const formatGroupedPromptViolations = (violations = [], options = {}) => {
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
    lines.push(buildNeedsLine(rg.rule));
    const actionLine = buildActionLine(rg.rule, options.taskRules);
    const hasActionLine = Boolean(actionLine);
    if (hasActionLine) lines.push(actionLine);

    const hasDetailedLocations = Boolean(options.detailedLocations);
    if (hasDetailedLocations) {
      lines.push('   Locations:');
      const tree = buildPathTree(rg.violations);
      const treeLines = renderTreeLines(tree, 0);
      lines.push(...treeLines);
    }
    lines.push('');
  });

  return lines;
};

export const buildAgentCommandsSection = () => [
  '### AI AGENT DISCOVERY & REFACTORING COMMANDS:',
  '- Claim Work: Run `chemx team task list --status=queued` and claim via `chemx team task claim <id> --as=@coder`.',
  '- Inspect Target: Run `chemx read <target_path> --outline` for AST signatures or `--outline --enrich` for signatures + logic flow without token bloat.',
  '- Verify & Auto-Resolve: Run `chemx verify`. Clean files auto-reconcile tasks to done in SQLite.',
  '- MCP Invocations: If invoking via MCP, pass command string directly via `chemx({ command: "..." })`.'
].join('\n');

export const buildGradeFPrompt = (report, options = {}) => {
  const { excludeAiSlop = false, isSubSection = false } = options;
  const { violations = [], hotspots = [] } = report;
  const critical = violations
    .filter((v) => v.severity === 'CRITICAL')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const extremeMonoliths = hotspots.filter(hasSizeClass('extreme'));

  const hasNoCritical = critical.length === 0;
  const hasNoMonoliths = extremeMonoliths.length === 0;
  const isReportEmpty = hasNoCritical && hasNoMonoliths;
  if (isReportEmpty) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:\n'
    : 'Act as a Principal Systems Architect. Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:\n';
  lines.push(preamble);

  const hasExtremeMonoliths = extremeMonoliths.length > 0;
  if (hasExtremeMonoliths) {
    lines.push(`### EXTREME MONOLITHS (${SIZE_LABELS.extreme} lines of code) : MONOLITH DECOMPOSITION`);
    lines.push('Action: Decompose into crystalline single-responsibility capsules (within the AGENTS.md line budget). Convert top-level view into a declarative Table-of-Contents view.\n');
    extremeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  const hasCritical = critical.length > 0;
  if (hasCritical) {
    lines.push('### CRITICAL AST VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(critical, { taskRules: report.taskRules }));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Pre-Split Pattern Discovery: Survey cross-file patterns before slicing; extract canonical shared capsules first to avoid proliferating duplicate one-off patterns.');
  lines.push(`2. Every new molecule component stays within the line budget. ${describeLineBudgetPolicy()}`);
  lines.push('3. Top-level page views must be 10-20 line declarative Table-of-Contents templates assembling components via named slots.');
  lines.push('4. Zero synthetic or mock data: return live data or explicit empty states.');
  lines.push('5. Zero render-hack setTimeout: replace with await nextTick() or flush: post.');
  lines.push('6. Output surgical diffs or modular replacements. Preserve existing external exports.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildGradeDPrompt = (report, options = {}) => {
  const { excludeAiSlop = false, isSubSection = false } = options;
  const { violations = [], hotspots = [] } = report;
  const high = violations
    .filter((v) => v.severity === 'HIGH')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const severeMonoliths = hotspots.filter(hasSizeClass('severe'));

  const hasNoHigh = high.length === 0;
  const hasNoMonoliths = severeMonoliths.length === 0;
  const isReportEmpty = hasNoHigh && hasNoMonoliths;
  if (isReportEmpty) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Refactor the following Grade D High-Severity Architectural Debts according to Chemical X Molecular Architecture Standards:\n'
    : 'Act as a Principal Systems Architect. Refactor the following Grade D High-Severity Architectural Debts according to Chemical X Molecular Architecture Standards:\n';
  lines.push(preamble);

  const hasSevereMonoliths = severeMonoliths.length > 0;
  if (hasSevereMonoliths) {
    lines.push(`### SEVERE MONOLITHS (${SIZE_LABELS.severeRange} lines of code)`);
    lines.push('Action: Extract sub-features into isolated molecule capsules (within the AGENTS.md line budget) and domain composables.\n');
    severeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  const hasHigh = high.length > 0;
  if (hasHigh) {
    lines.push('### HIGH SEVERITY VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(high, { taskRules: report.taskRules }));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Hook Saturation: Extract component hooks into dedicated domain composables adhering to the 3-5 property return limit (State + Status + Actions).');
  lines.push('2. Complex Control Flow: Break multi-clause conditionals into 2-stage atomic boolean variables with early-return guard clauses.');
  lines.push('3. Zero breaking changes to caller APIs or existing props.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildGradeCPrompt = (report, options = {}) => {
  const { excludeAiSlop = false, isSubSection = false } = options;
  const { violations = [], hotspots = [] } = report;
  const medium = violations
    .filter((v) => v.severity === 'MEDIUM')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));
  const warningMonoliths = hotspots.filter(hasSizeClass('warning'));

  const hasNoMedium = medium.length === 0;
  const hasNoMonoliths = warningMonoliths.length === 0;
  const isReportEmpty = hasNoMedium && hasNoMonoliths;
  if (isReportEmpty) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Refactor the following Grade C Medium-Severity Technical Debts according to Chemical X Molecular Architecture Standards:\n'
    : 'Act as a Senior Frontend Engineer. Refactor the following Grade C Medium-Severity Technical Debts according to Chemical X Molecular Architecture Standards:\n';
  lines.push(preamble);

  const hasWarningMonoliths = warningMonoliths.length > 0;
  if (hasWarningMonoliths) {
    lines.push(`### WARNING MONOLITHS (${SIZE_LABELS.warningRange} lines of code)`);
    lines.push(`Action: Bring file within the ${SIZE_LABELS.warnLimit} line budget by extracting helper functions, types, and child molecules.\n`);
    warningMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
    });
    lines.push('');
  }

  const hasMedium = medium.length > 0;
  if (hasMedium) {
    lines.push('### MEDIUM SEVERITY VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(medium, { taskRules: report.taskRules }));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Zero raw inline styles: Replace style={{...}} with atom props, SCSS mixins (@include glass), or scoped BEM classes.');
  lines.push('2. Extract anonymous inline callbacks into named functions before passing as props.');
  lines.push('3. Co-locate granular types (*.d.ts) inside feature capsules. Avoid type monoliths.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildGradeBPrompt = (report, options = {}) => {
  const { excludeAiSlop = false, isSubSection = false } = options;
  const { violations = [] } = report;
  const low = violations
    .filter((v) => v.severity === 'LOW')
    .filter((v) => (excludeAiSlop ? !v.isAiSlop : true));

  const hasNoLow = low.length === 0;
  if (hasNoLow) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Clean up the following Grade B Low-Severity Hygiene Issues according to Chemical X standards:\n'
    : 'Act as a Clean Code Specialist. Clean up the following Grade B Low-Severity Hygiene Issues according to Chemical X standards:\n';
  lines.push(preamble);

  lines.push('### LOW HYGIENE VIOLATIONS');
  lines.push(...formatGroupedPromptViolations(low, { taskRules: report.taskRules }));

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Typography Hygiene: Replace all em dashes with standard hyphens (-) or colons (:).');
  lines.push('2. Logging Hygiene: Remove unguarded console.log calls or route through central debug proxy.');
  lines.push('3. FontAwesome Compliance: Remove text-* utility classes from icons; use :color prop or inline CSS.');
  lines.push('4. Cascading Guards: Extract multi-condition validation sequences (>= 3 guards) into a dedicated domain validator function returning [boolean, string | null] or boolean (Directive 3.H).');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildAiSlopPrompt = (report, options = {}) => {
  const { isSubSection = false } = options;
  const { violations = [] } = report;
  const slopViolations = violations.filter((v) => Boolean(v.isAiSlop));

  const hasNoSlop = slopViolations.length === 0;
  if (hasNoSlop) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Eliminate the following AI Slop and conversational artifacts from our codebase according to Chemical X standards:\n'
    : 'Act as a Clean Code Specialist and Code Authenticity Guardian. Eliminate the following AI Slop and conversational artifacts from our codebase according to Chemical X standards:\n';
  lines.push(preamble);

  const hasSlopViolations = slopViolations.length > 0;
  if (hasSlopViolations) {
    lines.push('### AI SLOP & CODE AUTHENTICITY VIOLATIONS');
    lines.push(...formatGroupedPromptViolations(slopViolations, { taskRules: report.taskRules }));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Conversational Residue: Completely remove leaked AI conversational preambles, assistant markdown code fences, and pleasantry comments.');
  lines.push('2. Truncation Placeholders: Replace lazy AI truncation placeholders with complete, robust, and verifiable implementations.');
  lines.push('3. Echo Comments: Delete trivial parroting comments that merely restate adjacent self-documenting code.');
  lines.push('4. Paranoia Catch Wrappers: Replace shallow or empty catch blocks with intentional error propagation or ResultTuple ([data, error]).');
  lines.push('5. Inline Utility Reinventions: Replace reinvented inline helper utilities with shared project utilities or native methods.');
  lines.push('6. Type Widening: Eliminate lazy "any" type casts on error parameters or variables; enforce strict typing.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildHotspotsPrompt = (report, options = {}) => {
  const { isSubSection = false } = options;
  const { hotspots = [] } = report;
  const monolithHotspots = hotspots.filter(isMonolithHotspot);

  const hasNoMonoliths = monolithHotspots.length === 0;
  if (hasNoMonoliths) return '';

  const lines = [];
  const preamble = isSubSection
    ? 'Surgically decompose the following monolithic hotspot files according to Chemical X Molecular Architecture Standards:\n'
    : 'Act as a Principal Systems Architect. Surgically decompose the following monolithic hotspot files according to Chemical X Molecular Architecture Standards:\n';
  lines.push(preamble);

  const hasMonolithHotspots = monolithHotspots.length > 0;
  if (hasMonolithHotspots) {
    lines.push('### MONOLITHIC REFACTORING HOTSPOTS');
    lines.push('Action: Decompose into single-responsibility crystalline molecule capsules (within the AGENTS.md line budget) and dedicated domain composables.\n');
    monolithHotspots.forEach((h, i) => {
      const tier = h.monolithTier ? `[${h.monolithTier} MONOLITH]` : '[MONOLITH]';
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines, ${h.violationCount} hazards) ${tier}`);
    });
    lines.push('');
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Pre-Split Pattern Discovery: Audit recurring UI layouts, state machines, and predicates across monoliths first; extract canonical shared capsules before slicing to prevent bespoke pattern duplication.');
  lines.push(`2. Molecular Limits: ${describeLineBudgetPolicy()}`);
  lines.push('3. Table-of-Contents Views: Top-level page views must be 10 to 20 line declarative Table of Contents assembling molecules via named slots.');
  lines.push('4. Composable Return Contracts: Custom hooks/composables must classify returns into flat State, Status, and verb-prefixed Actions buckets (Directive 4.A).');
  lines.push('5. Type Co-location: Co-locate granular types/*.d.ts files inside each feature capsule instead of creating type monoliths.');
  lines.push('6. Zero breaking changes to external component APIs, route exports, or existing props.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const buildPillarPrompt = (report, pillarName, options = {}) => {
  const { isSubSection = false } = options;
  const { violations = [], hotspots = [] } = report;
  const pillarViolations = violations.filter((v) => v.pillar === pillarName);
  const isPillar1 = pillarName === 'Line Budgets & Monolith Decomposition';
  const relevantHotspots = isPillar1 ? hotspots.filter(isMonolithHotspot) : [];

  const hasNoViolations = pillarViolations.length === 0;
  const hasNoHotspots = relevantHotspots.length === 0;
  const isPillarEmpty = hasNoViolations && hasNoHotspots;
  if (isPillarEmpty) return '';

  const lines = [];
  const preamble = isSubSection
    ? `Surgically refactor the following ${pillarName} violations according to Chemical X Molecular Architecture Standards:\n`
    : `Act as a Principal Systems Architect. Surgically refactor the following ${pillarName} violations according to Chemical X Molecular Architecture Standards:\n`;
  lines.push(preamble);

  const hasRelevantHotspots = relevantHotspots.length > 0;
  if (hasRelevantHotspots) {
    lines.push('### MONOLITHIC REFACTORING HOTSPOTS');
    lines.push('Action: Decompose into crystalline molecule capsules (within the AGENTS.md line budget) and declarative Table-of-Contents views.\n');
    relevantHotspots.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines, ${h.violationCount} hazards)`);
    });
    lines.push('');
  }

  const hasPillarViolations = pillarViolations.length > 0;
  if (hasPillarViolations) {
    lines.push(`### ${pillarName.toUpperCase()} HAZARD VIOLATIONS`);
    lines.push(...formatGroupedPromptViolations(pillarViolations, { taskRules: report.taskRules }));
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Pre-Split Pattern Discovery: Survey cross-file patterns before slicing; extract canonical shared capsules first.');
  lines.push(`2. Molecular Capsule Limit: ${describeLineBudgetPolicy()}`);
  lines.push('3. Table-of-Contents Views: Top-level page views must be 10 to 20 line declarative templates assembling components via named slots.');
  lines.push('4. Zero breaking changes to external component APIs, route exports, or existing props.');
  if (!isSubSection) {
    lines.push('');
    lines.push(buildAgentCommandsSection());
  }

  return lines.join('\n');
};

export const deduplicateRefactoringCommands = (promptText) => {
  const isInvalidPrompt = typeof promptText !== 'string' || !promptText;
  if (isInvalidPrompt) return '';
  const headerMarker = '### AI AGENT DISCOVERY & REFACTORING COMMANDS:';
  const parts = promptText.split(headerMarker);
  const hasFewParts = parts.length <= 2;
  if (hasFewParts) return promptText;

  const prefix = parts.slice(0, -1).join('').replace(/---\s*\n\s*---\s*\n/g, '---\n').trimEnd();
  const lastSection = parts[parts.length - 1];
  return `${prefix}\n\n${headerMarker}${lastSection}`;
};

export const deduplicateRolePreambles = (promptText, options = {}) => {
  const isInvalidPrompt = typeof promptText !== 'string' || !promptText;
  if (isInvalidPrompt) return '';
  const { onlyIdentical = false } = options;
  let firstRole = null;
  const seenRoles = new Set();

  return promptText.replace(/(^|\n\s*)Act as (?:an?|the)\s+([^.\n]+?)\.\s+(?=[A-Z])/gi, (match, prefix, role) => {
    const normalizedRole = role.trim().toLowerCase();
    const hasNoFirstRole = !firstRole;
    if (hasNoFirstRole) {
      firstRole = normalizedRole;
      seenRoles.add(normalizedRole);
      return match;
    }

    if (onlyIdentical) {
      const hasSeenRole = seenRoles.has(normalizedRole);
      if (hasSeenRole) {
        return prefix;
      }
      return match;
    }

    return prefix;
  });
};

export const buildMasterPrompt = (report) => {
  const sections = [
    buildGradeFPrompt(report, { excludeAiSlop: true, isSubSection: true }),
    buildGradeDPrompt(report, { excludeAiSlop: true, isSubSection: true }),
    buildGradeCPrompt(report, { excludeAiSlop: true, isSubSection: true }),
    buildGradeBPrompt(report, { excludeAiSlop: true, isSubSection: true }),
    buildAiSlopPrompt(report, { isSubSection: true }),
    buildHotspotsPrompt(report, { isSubSection: true })
  ].filter(Boolean);

  const hasNoSections = sections.length === 0;
  if (hasNoSections) return '';

  const header = 'Act as a Principal Systems Architect. Execute a phased architectural refactoring of our codebase according to Chemical X Molecular Architecture Standards.\n\n';
  const rawPrompt = `${header}${sections.join('\n\n---\n\n')}\n\n---\n\n${buildAgentCommandsSection()}`;
  const dedupedRoles = deduplicateRolePreambles(rawPrompt);
  return deduplicateRefactoringCommands(dedupedRoles);
};

export const formatPromptBox = (title, promptText) => {
  const hasNoPrompt = !promptText;
  if (hasNoPrompt) return '';

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
