import fs from "node:fs";
import path from "node:path";
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion
} from "./terminal.js";
import {
  formatTerminalReport,
  generateMarkdownReport,
  groupViolationsBySeverity,
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection,
  formatAiSlopSection,
  formatHotspotsSection,
  getAuditHistory,
  getAuditBaseline,
  createSnapshotFromReport,
  formatTransformationTerminal,
  formatHistoryTimelineTerminal,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  buildMasterPrompt,
  copyToClipboard
} from "./audit.js";
import { resolveGradeBadge } from "./navigator-grades.js";
import { showPagedContent } from "./navigator-paged.js";
import { showConversionMenu } from "./navigator-conversion.js";
import { handleShareToDiscussions } from "./navigator-share.js";
import { runInstallWizard } from "./installer.js";
import { formatButtonTag } from "./navigator-menu.js";
import { runBadgeCommand } from "./badge.js";

const isExtremeMonolith = (h) => h.lineCount >= 2000;
const isSevereMonolith = (h) => h.lineCount >= 1000 && h.lineCount < 2000;
const isWarningMonolith = (h) => h.lineCount >= 500 && h.lineCount < 1000;
const isPassedPillar = (p) => p.status === "PASSED";
const hasGradeItems = (g) => g.count > 0;

export const buildActiveGrades = (report) => {
  const { hotspots, violations, pillars } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);

  const passedPillarsCount = Object.values(pillars || {}).filter(isPassedPillar).length;

  const extremeMonoliths = hotspots.filter(isExtremeMonolith);
  const severeMonoliths = hotspots.filter(isSevereMonolith);
  const warningMonoliths = hotspots.filter(isWarningMonolith);

  const gradeFCount = critical.length + extremeMonoliths.length;
  const gradeDCount = high.length + severeMonoliths.length;
  const gradeCCount = medium.length + warningMonoliths.length;
  const gradeBCount = low.length;
  const gradeACount = passedPillarsCount;

  const handleGradeAAction = async () => {
    await showPagedContent(formatGradeASection(report));
  };
  const handleGradeBAction = async () => {
    await showPagedContent(formatGradeBSection(report), buildGradeBPrompt(report));
  };
  const handleGradeCAction = async () => {
    await showPagedContent(formatGradeCSection(report), buildGradeCPrompt(report));
  };
  const handleGradeDAction = async () => {
    await showPagedContent(formatGradeDSection(report), buildGradeDPrompt(report));
  };
  const handleGradeFAction = async () => {
    await showPagedContent(formatGradeFSection(report), buildGradeFPrompt(report));
  };
  const slopViolations = (violations || []).filter((v) => v.isAiSlop);
  const handleSlopAction = async () => {
    await showPagedContent(formatAiSlopSection(report), buildAiSlopPrompt(report));
  };

  const gradeTiers = [
    {
      grade: "A",
      count: gradeACount,
      icon: "✅",
      description: "Compliant Checks & Passing Pillars",
      action: handleGradeAAction
    },
    {
      grade: report.aiSlop?.grade || (slopViolations.length > 0 ? "D" : "A"),
      count: slopViolations.length,
      icon: "🤖",
      description: `AI Slop & Authenticity (${report.aiSlop?.score ?? 100}/100 - ${report.aiSlop?.label ?? "Pure Artisanal"})`,
      action: handleSlopAction
    },
    {
      grade: "B",
      count: gradeBCount,
      icon: "💣",
      description: "Low Hygiene Issues & Minor Debts",
      action: handleGradeBAction
    },
    {
      grade: "C",
      count: gradeCCount,
      icon: "⚡",
      description: "Medium Severity Debts & Monolith Drift",
      action: handleGradeCAction
    },
    {
      grade: "D",
      count: gradeDCount,
      icon: "🔥",
      description: "High Severity Debts & Severe Monoliths",
      action: handleGradeDAction
    },
    {
      grade: "F",
      count: gradeFCount,
      icon: "💥",
      description: "Critical Hazards & Extreme Monoliths",
      action: handleGradeFAction
    }
  ];

  const createActiveGradeItem = (g) => ({
    key: `grade_${g.grade.toLowerCase()}`,
    grade: g.grade.toLowerCase(),
    tag: resolveGradeBadge(g.grade, 11),
    label: `${g.icon} Grade ${g.grade}: ${g.description} (${g.count} ${g.grade === "A" ? "clean" : "items"})`,
    action: g.action
  });

  return gradeTiers.filter(hasGradeItems).map(createActiveGradeItem);
};

export const buildDashboardActionGroups = ({ report, onScaffold = null, onRerun = null }) => {
  const handleInstallAction = async () => {
    await runInstallWizard(process.cwd());
    if (hasGum()) {
      gumChoose(["<-- Back to Audit Dashboard"]);
    }
  };

  const handleUpgradeAction = async () => {
    await showConversionMenu(onScaffold);
  };

  const handleReportAction = async () => {
    await showPagedContent(formatTerminalReport(report), buildMasterPrompt(report));
  };

  const handleRerunAction = async () => {
    if (onRerun) {
      await onRerun();
    }
  };

  const handleShareAction = async () => {
    await handleShareToDiscussions(report);
  };

  const handleProgressAction = async () => {
    const baseline = getAuditBaseline();
    const history = getAuditHistory();
    const currentSnapshot = createSnapshotFromReport(report);

    let output = "";
    if (baseline) {
      output += formatTransformationTerminal(baseline, currentSnapshot);
    } else {
      output +=
        "\n\x1b[33mNo baseline audit found. Current audit established as baseline.\x1b[0m\n";
    }

    if (history.length > 0) {
      output += "\n\n" + formatHistoryTimelineTerminal(history);
    }

    await showPagedContent(output);
  };

  const handleExportAction = async () => {
    const outName = hasGum()
      ? gumInput("Export file path:", "AUDIT_REPORT.md") || "AUDIT_REPORT.md"
      : (await promptQuestion("Export file path [AUDIT_REPORT.md]: ")) || "AUDIT_REPORT.md";
    const md = generateMarkdownReport(report);
    fs.writeFileSync(path.resolve(process.cwd(), outName), md, "utf-8");
    process.stdout.write(`\x1b[32m✔ Exported markdown audit report to ${outName}\x1b[0m\n\n`);
    if (hasGum()) {
      gumChoose(["<-- Back to Audit Dashboard"]);
    }
  };

  const handleBadgeAction = async () => {
    const grade = report?.health?.grade || 'A+';
    await runBadgeCommand([`--grade=${grade}`]);
    if (hasGum()) {
      gumChoose(["<-- Back to Audit Dashboard"]);
    } else {
      await promptQuestion("Press Enter to return to menu...");
    }
  };

  const handleCopyPromptAction = async () => {
    const masterPrompt = buildMasterPrompt(report);
    if (!masterPrompt) {
      process.stdout.write("\n\x1b[32m✔ Codebase is pristine (Grade A+). No refactoring prompt needed!\x1b[0m\n\n");
      if (hasGum()) {
        gumChoose(["<-- Back to Audit Dashboard"]);
      }
      return;
    }
    const success = copyToClipboard(masterPrompt);
    if (success) {
      process.stdout.write(
        "\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n" +
          "\x1b[36mPaste directly into Cursor, Claude, or Windsurf to resolve architectural hazards.\x1b[0m\n\n"
      );
    } else {
      process.stdout.write("\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n");
    }
    if (hasGum()) {
      gumChoose(["<-- Back to Audit Dashboard"]);
    }
  };

  const handleHotspotsAction = async () => {
    await showPagedContent(formatHotspotsSection(report), buildHotspotsPrompt(report));
  };

  const handleExitAction = async () => {};

  const monolithHotspots = (report?.hotspots || []).filter((h) => h.isMonolith || h.lineCount > 500);
  const hotspotsAction = {
    key: "hotspots",
    tag: formatButtonTag("Hotspots", "\x1b[38;5;208m"),
    label: `🔥 Top Refactoring Hotspots & Monoliths (${monolithHotspots.length} files)`,
    action: handleHotspotsAction
  };

  const installAction = {
    key: "install",
    tag: formatButtonTag("Install", "\x1b[32m"),
    label: "🪝 Install Pre-Commit Hook & GitHub CI Workflow",
    action: handleInstallAction
  };

  const upgradeAction = {
    key: "upgrade",
    tag: formatButtonTag("Upgrade", "\x1b[33m"),
    label: "💎 Unlock Full Molecular Rules & Scaffolding (Chemical X: Team Power Puff)",
    action: handleUpgradeAction
  };

  const reportAction = {
    key: "report",
    tag: formatButtonTag("Full Report", "\x1b[36m"),
    label: "📋 Show Full Report (All Sections at Once)",
    action: handleReportAction
  };

  const rerunAction = {
    key: "rerun",
    tag: formatButtonTag("Re-Run", "\x1b[32m"),
    label: "🔄 Re-Run Architecture Audit & Refresh Scorecard",
    action: handleRerunAction
  };

  const shareAction = {
    key: "share",
    tag: formatButtonTag("Share", "\x1b[35m"),
    label: "🕵  Plug your site and Post to GitHub Discussions (npx chemx audit)",
    action: handleShareAction
  };

  const progressAction = {
    key: "progress",
    tag: formatButtonTag("Progress", "\x1b[32m"),
    label: "📈 View Before & After Transformation Progress",
    action: handleProgressAction
  };

  const exportAction = {
    key: "export",
    tag: formatButtonTag("Export", "\x1b[36m"),
    label: "💾 Export Markdown Report to File",
    action: handleExportAction
  };

  const badgeAction = {
    key: "badge",
    tag: formatButtonTag("Badge", "\x1b[38;2;98;201;255m"),
    label: "🏷️  Get Chemical X Footer Badge (Vue, React, HTML)",
    action: handleBadgeAction
  };

  const copyPromptAction = {
    key: "prompt",
    tag: formatButtonTag("Prompt", "\x1b[38;2;98;201;255m"),
    label: "📋 Copy AI Prompt Fix to Clipboard",
    action: handleCopyPromptAction
  };

  const exitAction = {
    key: "exit",
    tag: formatButtonTag("Exit", "\x1b[90m"),
    label: "🚪 Exit",
    action: handleExitAction
  };

  const masterPrompt = buildMasterPrompt(report);
  const isGradeAPlus = report?.health?.grade === "A+" || report?.metrics?.grade === "A+";
  const hasPromptToCopy = Boolean(masterPrompt && masterPrompt.trim().length > 0);
  const isCleanAPlus = isGradeAPlus && !hasPromptToCopy;
  const shouldShowPromptAction = hasPromptToCopy && !isCleanAPlus;

  return {
    installAction,
    upgradeAction,
    reportAction,
    rerunAction,
    shareAction,
    progressAction,
    exportAction,
    badgeAction,
    hotspotsAction,
    hasHotspots: monolithHotspots.length > 0,
    copyPromptAction,
    exitAction,
    shouldShowPromptAction
  };
};
