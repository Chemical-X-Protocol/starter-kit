const CYAN = '\x1b[38;2;98;201;255m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export const buildGradeFPrompt = (report) => {
  const { violations, hotspots } = report;
  const critical = violations.filter((v) => v.severity === 'CRITICAL');
  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000);

  if (critical.length === 0 && extremeMonoliths.length === 0) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:\n');

  if (extremeMonoliths.length > 0) {
    lines.push('### EXTREME MONOLITHS (>= 2,000 lines of code) : MONOLITH DECOMPOSITION');
    extremeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
      lines.push('   Action: Decompose this monolith into crystalline single-responsibility capsules (< 100 lines per molecule). Convert top-level view into a declarative Table-of-Contents view.');
    });
    lines.push('');
  }

  if (critical.length > 0) {
    lines.push('### CRITICAL AST VIOLATIONS');
    critical.forEach((v, i) => {
      lines.push(`${i + 1}. \`${v.filePath}:${v.line}:${v.column}\` [${v.rule}]`);
      lines.push(`   Hazard: ${v.hazard}`);
      lines.push(`   Directive: ${v.directive}`);
    });
    lines.push('');
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Every new molecule component must stay under 100 lines.');
  lines.push('2. Top-level page views must be 10-20 line declarative Table-of-Contents templates assembling components via named slots.');
  lines.push('3. Zero synthetic or mock data: return live data or explicit empty states.');
  lines.push('4. Zero render-hack setTimeout: replace with await nextTick() or flush: post.');
  lines.push('5. Output surgical diffs or modular replacements. Preserve existing external exports.');

  return lines.join('\n');
};

export const buildGradeDPrompt = (report) => {
  const { violations, hotspots } = report;
  const high = violations.filter((v) => v.severity === 'HIGH');
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000);

  if (high.length === 0 && severeMonoliths.length === 0) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Refactor the following Grade D High-Severity Architectural Debts according to Chemical X Molecular Architecture Standards:\n');

  if (severeMonoliths.length > 0) {
    lines.push('### SEVERE MONOLITHS (1,000 - 1,999 lines of code)');
    severeMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
      lines.push('   Action: Extract sub-features into isolated molecule capsules (< 100 lines of code) and domain composables.');
    });
    lines.push('');
  }

  if (high.length > 0) {
    lines.push('### HIGH SEVERITY VIOLATIONS');
    high.forEach((v, i) => {
      lines.push(`${i + 1}. \`${v.filePath}:${v.line}:${v.column}\` [${v.rule}]`);
      lines.push(`   Hazard: ${v.hazard}`);
      lines.push(`   Directive: ${v.directive}`);
    });
    lines.push('');
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Hook Saturation: Extract component hooks into dedicated domain composables adhering to the 3-5 property return limit (State + Status + Actions).');
  lines.push('2. Complex Control Flow: Break multi-clause conditionals into 2-stage atomic boolean variables with early-return guard clauses.');
  lines.push('3. Zero breaking changes to caller APIs or existing props.');

  return lines.join('\n');
};

export const buildGradeCPrompt = (report) => {
  const { violations, hotspots } = report;
  const medium = violations.filter((v) => v.severity === 'MEDIUM');
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000);

  if (medium.length === 0 && warningMonoliths.length === 0) return '';

  const lines = [];
  lines.push('Act as a Senior Frontend Engineer. Refactor the following Grade C Medium-Severity Technical Debts according to Chemical X Molecular Architecture Standards:\n');

  if (warningMonoliths.length > 0) {
    lines.push('### WARNING MONOLITHS (500 - 999 lines of code)');
    warningMonoliths.forEach((h, i) => {
      lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines)`);
      lines.push('   Action: Bring file under 500 line budget by extracting helper functions, types, and child molecules.');
    });
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('### MEDIUM SEVERITY VIOLATIONS');
    medium.forEach((v, i) => {
      lines.push(`${i + 1}. \`${v.filePath}:${v.line}:${v.column}\` [${v.rule}]`);
      lines.push(`   Hazard: ${v.hazard}`);
      lines.push(`   Directive: ${v.directive}`);
    });
    lines.push('');
  }

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Zero raw inline styles: Replace style={{...}} with atom props, SCSS mixins (@include glass), or scoped BEM classes.');
  lines.push('2. Extract anonymous inline callbacks into named functions before passing as props.');
  lines.push('3. Co-locate granular types (*.d.ts) inside feature capsules (< 100 lines of code). Avoid type monoliths.');

  return lines.join('\n');
};

export const buildGradeBPrompt = (report) => {
  const { violations } = report;
  const low = violations.filter((v) => v.severity === 'LOW');

  if (low.length === 0) return '';

  const lines = [];
  lines.push('Act as a Clean Code Specialist. Clean up the following Grade B Low-Severity Hygiene Issues according to Chemical X standards:\n');

  lines.push('### LOW HYGIENE VIOLATIONS');
  low.forEach((v, i) => {
    lines.push(`${i + 1}. \`${v.filePath}:${v.line}:${v.column}\` [${v.rule}]`);
    lines.push(`   Hazard: ${v.hazard}`);
    lines.push(`   Directive: ${v.directive}`);
  });
  lines.push('');

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Typography Hygiene: Replace all em dashes with standard hyphens (-) or colons (:).');
  lines.push('2. Logging Hygiene: Remove unguarded console.log calls or route through central debug proxy.');
  lines.push('3. FontAwesome Compliance: Remove text-* utility classes from icons; use :color prop or inline CSS.');

  return lines.join('\n');
};

export const buildAiSlopPrompt = (report) => {
  const { violations = [] } = report;
  const slopViolations = violations.filter((v) => Boolean(v.isAiSlop));

  if (slopViolations.length === 0) return '';

  const lines = [];
  lines.push('Act as a Clean Code Specialist and Code Authenticity Guardian. Eliminate the following AI Slop and conversational artifacts from our codebase according to Chemical X standards:\n');

  lines.push('### AI SLOP & CODE AUTHENTICITY VIOLATIONS');
  slopViolations.forEach((v, i) => {
    lines.push(`${i + 1}. \`${v.filePath}:${v.line}:${v.column}\` [${v.rule}]`);
    lines.push(`   Hazard: ${v.hazard}`);
    lines.push(`   Directive: ${v.directive}`);
  });
  lines.push('');

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

  if (monolithHotspots.length === 0) return '';

  const lines = [];
  lines.push('Act as a Principal Systems Architect. Surgically decompose the following monolithic hotspot files according to Chemical X Molecular Architecture Standards:\n');

  lines.push('### MONOLITHIC REFACTORING HOTSPOTS');
  monolithHotspots.forEach((h, i) => {
    const tier = h.monolithTier ? `[${h.monolithTier} MONOLITH]` : '[MONOLITH]';
    lines.push(`${i + 1}. File: \`${h.filePath}\` (${h.lineCount} lines, ${h.violationCount} hazards) ${tier}`);
    lines.push('   Action: Decompose into single-responsibility crystalline molecule capsules (< 100 lines) and dedicated domain composables.');
  });
  lines.push('');

  lines.push('### STRICT EXECUTION RULES:');
  lines.push('1. Molecular Limits: Molecule capsules must strictly remain under 100 lines per file.');
  lines.push('2. Table-of-Contents Views: Top-level page views must be 10 to 20 line declarative Table of Contents assembling molecules via named slots.');
  lines.push('3. Composable Return Contracts: Custom hooks/composables must strictly limit returns to 3 to 5 properties (State + Status + Actions).');
  lines.push('4. Type Co-location: Co-locate granular types/*.d.ts files inside each feature capsule (< 100 lines per type file) instead of creating type monoliths.');
  lines.push('5. Zero breaking changes to external component APIs, route exports, or existing props.');

  return lines.join('\n');
};

export const buildMasterPrompt = (report) => {
  const sections = [
    buildGradeFPrompt(report),
    buildGradeDPrompt(report),
    buildGradeCPrompt(report),
    buildGradeBPrompt(report),
    buildAiSlopPrompt(report),
    buildHotspotsPrompt(report)
  ].filter(Boolean);

  if (sections.length === 0) return '';

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
