import {
  buildMasterPrompt,
  formatPromptBox
} from './prompts.js';
import {
  BOLD,
  DIM,
  RESET,
  resolveTopSectionColor
} from './reporter-utils.js';
import { getChemicalXAsciiBanner } from './reporter-banner.js';
import { formatDirectoryDistributionSection } from './reporter-grouping.js';
import {
  formatScorecardSection,
  formatCriticalSection,
  formatHighMediumSection,
  formatLowSection,
  formatPillarsSection,
  formatSinglePillarSection,
  formatHotspotsSection,
  formatContextAnalysisSection,
  formatAiSlopSection
} from './reporter-sections.js';
import {
  formatRoadmapSection,
  formatRoadmapMarkdown,
  buildSelfHealingRoadmapPrompt
} from './roadmap.js';
import {
  formatGradeASection,
  formatGradeBSection,
  formatGradeCSection,
  formatGradeDSection,
  formatGradeFSection
} from './reporter-grades.js';

export {
  formatRoadmapSection,
  formatRoadmapMarkdown,
  buildSelfHealingRoadmapPrompt
};

export {
  groupViolationsBySeverity,
  getSeverityBadge,
  getStatusBadge,
  resolveGradeColor,
  resolveHealthHearts,
  resolveRiskColor,
  resolveHotspotBadge,
  resolveTopSectionColor,
  resolveMarkdownStatusIcon,
  resolveMarkdownMonolithText,
  formatPillarReactionBadgesTerminal,
  formatPillarReactionBadgesMarkdown,
  formatPillarShieldBadges,
  resolveBadgeColor,
  PILLAR_EMOJIS,
  PILLAR_SHORT_NAMES,
  NUMBER_EMOJIS,
  resolvePriorityBadge,
  CYAN,
  GREEN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET
} from './reporter-utils.js';

export {
  resolveDirectory,
  groupViolationsByDirectory,
  groupViolationsByRule,
  buildPathTree,
  formatCompactLocations,
  renderGroupedViolationsTerminal,
  formatDirectoryDistributionSection
} from './reporter-grouping.js';

export {
  formatDirectoryRollupMarkdown,
  renderGroupedViolationsMarkdown
} from './reporter-grouping-markdown.js';

export { generateMarkdownReport } from './reporter-markdown.js';

export {
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection
} from './reporter-grades.js';

export {
  getAsciiGradeLines,
  formatAsciiGrade,
  getReportCardAsciiLines,
  REPORT_CARD_ASCII
} from './reporter-ascii.js';

export { getChemicalXAsciiBanner } from './reporter-banner.js';

export {
  formatScorecardSection,
  formatCriticalSection,
  formatHighMediumSection,
  formatLowSection,
  formatPillarsSection,
  formatSinglePillarSection,
  formatHotspotsSection,
  formatContextAnalysisSection,
  formatAiSlopSection
} from './reporter-sections.js';

export {
  formatFailuresSection,
  formatPassesSection
} from './reporter-summary.js';

export const formatTerminalReport = (report) => {
  const lines = [];
  const topColor = resolveTopSectionColor(report);

  lines.push('');
  lines.push(getChemicalXAsciiBanner(report?.health?.grade));
  lines.push(`${topColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${topColor}   CHEMICAL X PROTOCOL : FULL CODEBASE ARCHITECTURAL AUDIT REPORT${RESET}`);
  lines.push(`${DIM}   Molecular Architecture Standards & Context Hazard Verification${RESET}`);
  lines.push(`${topColor}======================================================================${RESET}`);

  lines.push(formatScorecardSection(report, topColor));
  lines.push(formatContextAnalysisSection(report, topColor));
  lines.push(formatPillarsSection(report, topColor));
  lines.push(formatHotspotsSection(report, topColor, { includePrompt: false }));
  lines.push(formatDirectoryDistributionSection(report, topColor));
  lines.push(formatAiSlopSection(report, topColor, { includePrompt: false }));
  lines.push(formatRoadmapSection(report, topColor));
  lines.push(formatGradeASection(report));
  lines.push(formatGradeBSection(report, { includePrompt: false }));
  lines.push(formatGradeCSection(report, { includePrompt: false }));
  lines.push(formatGradeDSection(report, { includePrompt: false }));
  lines.push(formatGradeFSection(report, { includePrompt: false }));

  const masterPrompt = buildMasterPrompt(report);
  if (masterPrompt) {
    lines.push(formatPromptBox('🤖 MASTER AI AGENT REFACTORING PROMPT', masterPrompt));
  }

  return lines.join('\n');
};
