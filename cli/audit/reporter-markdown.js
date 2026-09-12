import { buildMasterPrompt } from './prompts.js';
import {
  groupViolationsBySeverity,
  resolveHealthHearts,
  resolveMarkdownStatusIcon,
  resolveMarkdownMonolithText,
  PILLAR_EMOJIS,
  NUMBER_EMOJIS
} from './reporter-utils.js';
import {
  formatDirectoryRollupMarkdown,
  renderGroupedViolationsMarkdown
} from './reporter-grouping-markdown.js';

export const generateMarkdownReport = (report) => {
  const { metrics, health, pillars, contextAnalysis, hotspots, violations, aiSlop } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('# Chemical X Protocol: Architectural Audit Report');
  lines.push('');
  lines.push('> *Comprehensive static analysis report enforcing Chemical X Molecular Architecture standards.*');
  lines.push('');
  lines.push('## 1. Executive Summary & Scorecard');
  lines.push('');
  lines.push('| Metric | Value | Status |');
  lines.push('| :--- | :--- | :--- |');
  const hearts = resolveHealthHearts(health?.grade, health?.score, false);
  lines.push(`| **Life / Health Meter** | ${hearts} (Grade **${health.grade}**) | ${health.score} / 100 (${health.label}) |`);
  lines.push(`| **Molecular Health Index** | **${health.score} / 100** | Grade: **${health.grade}** (${health.label}) |`);
  const slopScore = aiSlop?.score ?? 100;
  const slopGrade = aiSlop?.grade ?? 'A+';
  const slopLabel = aiSlop?.label ?? 'Pure Artisanal';
  lines.push(`| **AI Slop Index (ASI)** | **${slopScore} / 100** | Grade: **${slopGrade}** (${slopLabel}) |`);
  lines.push(`| **Scanned Files** | ${metrics.scannedFiles} source files | Verified |`);
  lines.push(`| **Total Lines of Code** | ${metrics.totalLoc} lines of code | Avg ${metrics.avgLoc} lines/file |`);
  lines.push(`| **Largest File** | \`${metrics.largestFile.filePath || 'None'}\` | ${metrics.largestFile.lineCount} lines |`);
  lines.push(`| **Context Token Overhead** | ~${contextAnalysis.estimatedTokens.toLocaleString()} tokens | Est. Bloat: ~${contextAnalysis.estimatedExcessTokens.toLocaleString()} tokens |`);
  lines.push(`| **Token Reduction Target** | **${contextAnalysis.potentialSavingsPct}%** | Risk Level: **${contextAnalysis.riskLevel}** |`);
  if (contextAnalysis.excessCostPerPass !== undefined) {
    lines.push(`| **Monolith Cost per Turn** | **$${contextAnalysis.excessCostPerPass.toFixed(3)}** | Model: ${contextAnalysis.pricingModel} |`);
    lines.push(`| **Projected Dev Context Tax** | **$${contextAnalysis.monthlyWastePerDev.toFixed(2)} / mo** | Est. $${contextAnalysis.weeklyWastePerDev.toFixed(2)} / week per engineer |`);
  }
  lines.push(`| **Total Hazards Flagged** | **${violations.length}** | Critical: ${critical.length}, High: ${high.length}, Med: ${medium.length}, Low: ${low.length} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. 7-Pillar Architectural Compliance Matrix');
  lines.push('');
  lines.push('| Pillar | Status | Violations | Critical | High | Med | Low |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');

  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const statusIcon = resolveMarkdownStatusIcon(data.status);
    const violationsText = data.violations === 0 ? '🟢 0' : `⚠️ **${data.violations}**`;
    lines.push(`| ${icon} ${pillarName} | ${statusIcon} | ${violationsText} | ${data.critical} | ${data.high} | ${data.medium} | ${data.low} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 3. Top Refactoring Hotspots');
  lines.push('');
  if (hotspots.length === 0) {
    lines.push('No hotspot files identified. All analyzed files remain within architectural line budgets.');
  } else {
    lines.push('| Priority | File Path | Line Count | Violations | Monolith Hazard |');
    lines.push('| :---: | :--- | :---: | :---: | :---: |');
    hotspots.forEach((h, idx) => {
      const monolithText = resolveMarkdownMonolithText(h.lineCount);
      const priorityBadge = NUMBER_EMOJIS[idx] || `${idx + 1}`;
      lines.push(`| ${priorityBadge} | \`${h.filePath}\` | ${h.lineCount} | ${h.violationCount} | ${monolithText} |`);
    });
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 4. Architectural Hazard Inventory (Grouped by Directory & Severity)');
  lines.push('');

  if (violations.length === 0) {
    lines.push('Zero context hazard violations detected across all line budgets, hooks, and AST rules.');
  } else {
    lines.push(formatDirectoryRollupMarkdown(violations));

    if (critical.length > 0) {
      lines.push('### Critical Hazards (Immediate Action Required)');
      lines.push('');
      lines.push(renderGroupedViolationsMarkdown(critical, { showSeverity: false }));
    }

    if (high.length > 0 || medium.length > 0) {
      lines.push('### High & Medium Hazards (Architecture Debts)');
      lines.push('');
      lines.push(renderGroupedViolationsMarkdown([...high, ...medium], { showSeverity: true }));
    }

    if (low.length > 0) {
      lines.push('### Low & Hygiene Issues (Typography & Logging)');
      lines.push('');
      lines.push(renderGroupedViolationsMarkdown(low, { showSeverity: false }));
    }
  }

  const slopViolations = violations.filter((v) => v.isAiSlop);
  lines.push('---');
  lines.push('');
  lines.push('## 5. AI Slop & Code Authenticity Audit');
  lines.push('');
  lines.push(`* **AI Slop Index (ASI)**: **${slopScore} / 100** (Grade: **${slopGrade}** - ${slopLabel})`);
  lines.push(`* **Slop Hazards Flagged**: **${slopViolations.length}**`);
  lines.push('');

  if (slopViolations.length === 0) {
    lines.push('🟢 Zero AI slop detected. Codebase demonstrates pure artisanal craftsmanship with no LLM conversational residue or echo comments.');
  } else {
    lines.push(renderGroupedViolationsMarkdown(slopViolations, { showSeverity: true }));
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## 6. Remediation Roadmap');
  lines.push('');
  lines.push('1. **Decompose Monoliths**: Break down any file exceeding 500 lines into single-responsibility capsules.');
  lines.push('2. **Cap Molecule Size**: Ensure all molecule components (`m-*`) remain strictly under 100 lines.');
  lines.push('3. **Two-Stage Boolean Logic**: Replace complex multi-clause expressions with atomic boolean variables.');
  lines.push('4. **Lifecycle-Safe Timers**: Migrate raw `setInterval` and `setTimeout` calls to self-cleaning composables.');
  lines.push('5. **Purge AI Slop**: Remove conversational residue, eliminate echo comments, and inline single-use passthrough assignments.');
  lines.push('');

  const masterPrompt = buildMasterPrompt(report);
  if (masterPrompt) {
    lines.push('---');
    lines.push('');
    lines.push('## 7. 🤖 Copy-Paste AI Agent Refactoring Directives');
    lines.push('');
    lines.push('Feed the prompt below directly into your AI coding agent (Cursor, Windsurf, Claude, Copilot, or Antigravity) to surgically refactor flagged hazards:');
    lines.push('');
    lines.push('```markdown');
    lines.push(masterPrompt);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
};
