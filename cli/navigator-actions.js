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
  formatSinglePillarSection,
  buildPillarPrompt,
  PILLAR_EMOJIS,
  PILLAR_SHORT_NAMES,
  buildHotspotsPrompt,
  buildMasterPrompt,
  formatRoadmapSection,
  buildSelfHealingRoadmapPrompt,
  copyToClipboard
} from "./audit.js";
import {
  resolveGradeBadge,
  resolveIndividualPillarGrade,
  resolvePillarRiskWeight
} from "./navigator-grades.js";
import { showPagedContent } from "./navigator-paged.js";
import { showConversionMenu } from "./navigator-conversion.js";
import { handleShareToDiscussions } from "./navigator-share.js";
import { runInstallWizard } from "./installer.js";
import { formatButtonTag } from "./navigator-menu.js";
import { runBadgeCommand } from "./badge.js";

const GRADE_RISK_RANKS = {
  F: 5,
  D: 4,
  C: 3,
  B: 2,
  A: 1,
  'A+': 0
};

const comparePillarsByRisk = (a, b) => {
  const rankA = GRADE_RISK_RANKS[a.grade] ?? 0;
  const rankB = GRADE_RISK_RANKS[b.grade] ?? 0;
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (b.riskWeight !== a.riskWeight) {
    return b.riskWeight - a.riskWeight;
  }

  if (b.violations !== a.violations) {
    return b.violations - a.violations;
  }

  return a.originalIndex - b.originalIndex;
};

export const buildActiveGrades = (report) => {
  const { pillars = {}, violations = [], aiSlop } = report;
  const pillarEntries = Object.entries(pillars);
  const items = [];

  pillarEntries.forEach(([pillarName, data], index) => {
    const grade = resolveIndividualPillarGrade(data);
    const riskWeight = resolvePillarRiskWeight(data);
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const shortName = PILLAR_SHORT_NAMES[pillarName] || pillarName;
    const isClean = data.violations === 0;
    const countLabel = isClean
      ? '0 items'
      : `${data.violations} ${data.violations === 1 ? 'item' : 'items'}`;

    const handlePillarAction = async () => {
      await showPagedContent(
        formatSinglePillarSection(report, pillarName),
        buildPillarPrompt(report, pillarName)
      );
    };

    items.push({
      key: `pillar_${data.pillarKey || index + 1}`,
      name: pillarName,
      shortName,
      grade,
      riskWeight,
      violations: data.violations || 0,
      originalIndex: index,
      tag: resolveGradeBadge(grade, 11),
      label: `${icon} ${pillarName} (${countLabel})`,
      action: handlePillarAction
    });
  });

  if (aiSlop) {
    const slopViolations = violations.filter((v) => v.isAiSlop);
    const slopGrade = aiSlop.grade || (slopViolations.length > 0 ? 'D' : 'A+');
    const slopRiskWeight = resolvePillarRiskWeight(aiSlop.breakdown);
    const slopCount = slopViolations.length;
    const isSlopClean = slopCount === 0;
    const slopCountLabel = isSlopClean
      ? '0 items'
      : `${slopCount} ${slopCount === 1 ? 'item' : 'items'}`;

    const handleSlopAction = async () => {
      await showPagedContent(formatAiSlopSection(report), buildAiSlopPrompt(report));
    };

    items.push({
      key: 'grade_slop',
      name: 'AI Slop & Code Authenticity',
      shortName: 'Slop',
      grade: slopGrade,
      riskWeight: slopRiskWeight,
      violations: slopCount,
      originalIndex: pillarEntries.length,
      tag: resolveGradeBadge(slopGrade, 11),
      label: `🤖 AI Slop & Authenticity (${aiSlop.score ?? 100}/100 - ${aiSlop.label ?? 'Pure Artisanal'}) (${slopCountLabel})`,
      action: handleSlopAction
    });
  }

  items.sort(comparePillarsByRisk);
  return items;
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

  const handleRoadmapAction = async () => {
    await showPagedContent(formatRoadmapSection(report), buildSelfHealingRoadmapPrompt(report));
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
        "\n\x1b[33mNo baseline audit found. Current audit established as baseline floor.\x1b[0m\n";
    }

    const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
    if (previousSnapshot && previousSnapshot.id !== baseline?.id) {
      output += "\n\n" + formatTransformationTerminal(previousSnapshot, currentSnapshot, { isStepDelta: true });
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

  const roadmapAction = {
    key: "roadmap",
    tag: formatButtonTag("Roadmap", "\x1b[38;2;45;212;191m"),
    label: "🌱 Self-Healing Fix Roadmap (Optimal Remediation Order & Pattern Harvesting)",
    action: handleRoadmapAction
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
    roadmapAction,
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
