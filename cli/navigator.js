import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  stripAnsi,
  confirmAction
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
  getChemicalXAsciiBanner,
  saveAuditSnapshot,
  getAuditHistory,
  getAuditBaseline,
  createSnapshotFromReport,
  formatTransformationTerminal,
  formatHistoryTimelineTerminal,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildMasterPrompt,
  DISCUSSION_CATEGORY
} from "./audit.js";

import {
  resolveGradeColor,
  resolveGradeBadge,
  resolveCriticalGrade,
  resolveHighMedGrade,
  resolveLowGrade,
  resolvePillarGrade,
  resolveHotspotGrade,
  resolveContextGrade
} from "./navigator-grades.js";
import { extractPromptFromContent, showPagedContent } from "./navigator-paged.js";
import { showConversionMenu } from "./navigator-conversion.js";
import { handleShareToDiscussions } from "./navigator-share.js";
import { runInstallWizard } from "./installer.js";

export {
  resolveGradeColor,
  resolveGradeBadge,
  resolveCriticalGrade,
  resolveHighMedGrade,
  resolveLowGrade,
  resolvePillarGrade,
  resolveHotspotGrade,
  resolveContextGrade
} from "./navigator-grades.js";
export { extractPromptFromContent, showPagedContent } from "./navigator-paged.js";
export { showConversionMenu } from "./navigator-conversion.js";
export { handleShareToDiscussions } from "./navigator-share.js";

const isExtremeMonolith = (h) => h.lineCount >= 2000;
const isSevereMonolith = (h) => h.lineCount >= 1000 && h.lineCount < 2000;
const isWarningMonolith = (h) => h.lineCount >= 500 && h.lineCount < 1000;
const isPassedPillar = (p) => p.status === "PASSED";
const hasGradeItems = (g) => g.count > 0;

export const renderDashboardBanner = (
  health,
  metrics,
  violations,
  critical,
  highMediumCount,
  low
) => {
  if (process.stdout.isTTY) {
    console.clear();
  }
  process.stdout.write(getChemicalXAsciiBanner(health.grade));

  const gColor = resolveGradeColor(health.grade);
  const critColor = critical.length > 0 ? "\x1b[31;1m" : "\x1b[32m";
  const highMedColor = highMediumCount > 0 ? "\x1b[38;5;208;1m" : "\x1b[32m";
  const lowColor = low.length > 0 ? "\x1b[33;1m" : "\x1b[32m";

  if (hasGum()) {
    spawnSync(
      "gum",
      [
        "style",
        "--border=rounded",
        "--border-foreground=81",
        "--padding=0 2",
        "--bold",
        `\x1b[1m\x1b[38;2;98;201;255mChemical X Protocol: Architectural Audit Dashboard\x1b[0m\n` +
          `Health Score: \x1b[1m\x1b[38;2;98;201;255m${health.score}/100\x1b[0m ${gColor}[Grade: ${health.grade}]\x1b[0m (${gColor}${health.label}\x1b[0m)\n` +
          `Scanned: \x1b[36m${metrics.scannedFiles} files\x1b[0m | LOC: \x1b[36m${metrics.totalLoc}\x1b[0m | Violations: \x1b[33m${violations.length}\x1b[0m\n` +
          `Hazards: ${critColor}${critical.length} Critical\x1b[0m | ${highMedColor}${highMediumCount} High/Med\x1b[0m | ${lowColor}${low.length} Low\x1b[0m`
      ],
      { stdio: "inherit" }
    );
  } else {
    process.stdout.write(
      `\n\x1b[1m\x1b[38;2;98;201;255mChemical X Protocol: Architectural Audit Dashboard\x1b[0m\n` +
        `Health Score: \x1b[1m\x1b[38;2;98;201;255m${health.score}/100\x1b[0m ${gColor}[Grade: ${health.grade}]\x1b[0m (${gColor}${health.label}\x1b[0m)\n` +
        `Scanned: \x1b[36m${metrics.scannedFiles} files\x1b[0m | LOC: \x1b[36m${metrics.totalLoc}\x1b[0m | Violations: \x1b[33m${violations.length}\x1b[0m\n` +
        `Hazards: ${critColor}${critical.length} Critical\x1b[0m | ${highMedColor}${highMediumCount} High/Med\x1b[0m | ${lowColor}${low.length} Low\x1b[0m\n\n`
    );
  }
};

export const runInteractiveAuditNavigator = async (report, onScaffold = null) => {
  saveAuditSnapshot(report);
  const { metrics, health, hotspots, violations, pillars } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const highMediumCount = high.length + medium.length;

  const passedPillarsCount = Object.values(pillars || {}).filter(isPassedPillar).length;

  const extremeMonoliths = hotspots.filter(isExtremeMonolith);
  const severeMonoliths = hotspots.filter(isSevereMonolith);
  const warningMonoliths = hotspots.filter(isWarningMonolith);

  const gradeFCount = critical.length + extremeMonoliths.length;
  const gradeDCount = high.length + severeMonoliths.length;
  const gradeCCount = medium.length + warningMonoliths.length;
  const gradeBCount = low.length;
  const gradeACount = passedPillarsCount;

  const actions = [
    {
      key: "report",
      tag: "\x1b[36m[Report   ]\x1b[0m",
      label: "📋 Show Full Report (All Sections at Once)",
      action: async () => {
        await showPagedContent(formatTerminalReport(report), buildMasterPrompt(report));
      }
    },
    {
      key: "progress",
      tag: "\x1b[32m[Progress ]\x1b[0m",
      label: "📈 View Before & After Transformation Progress",
      action: async () => {
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
      }
    },
    {
      key: "share",
      tag: "\x1b[35m[Share    ]\x1b[0m",
      label: `🕵  Post to GitHub Discussions (${DISCUSSION_CATEGORY})`,
      action: async () => {
        await handleShareToDiscussions(report);
      }
    },
    {
      key: "export",
      tag: "\x1b[36m[Export   ]\x1b[0m",
      label: "💾 Export Markdown Report to File",
      action: async () => {
        const outName = hasGum()
          ? gumInput("Export file path:", "AUDIT_REPORT.md") || "AUDIT_REPORT.md"
          : (await promptQuestion("Export file path [AUDIT_REPORT.md]: ")) || "AUDIT_REPORT.md";
        const md = generateMarkdownReport(report);
        fs.writeFileSync(path.resolve(process.cwd(), outName), md, "utf-8");
        process.stdout.write(`\x1b[32m✔ Exported markdown audit report to ${outName}\x1b[0m\n\n`);
        if (hasGum()) {
          gumChoose(["<-- Back to Audit Dashboard"]);
        }
      }
    },
    {
      key: "install",
      tag: "\x1b[32m[Install  ]\x1b[0m",
      label: "🪝 Install Pre-Commit Hook & GitHub CI Workflow",
      action: async () => {
        await runInstallWizard(process.cwd());
        if (hasGum()) {
          gumChoose(["<-- Back to Audit Dashboard"]);
        }
      }
    },
    {
      key: "upgrade",
      tag: "\x1b[33m[Upgrade  ]\x1b[0m",
      label: "💎 Unlock Full Molecular Rules & Scaffolding (Chemical X: Team Power Puff)",
      action: async () => {
        await showConversionMenu(onScaffold);
      }
    }
  ];

  const gradeTiers = [
    {
      grade: "F",
      count: gradeFCount,
      icon: "❌",
      description: "Critical Hazards & Extreme Monoliths",
      action: async () => {
        await showPagedContent(formatGradeFSection(report), buildGradeFPrompt(report));
      }
    },
    {
      grade: "D",
      count: gradeDCount,
      icon: "⚠️ ",
      description: "High Severity Debts & Severe Monoliths",
      action: async () => {
        await showPagedContent(formatGradeDSection(report), buildGradeDPrompt(report));
      }
    },
    {
      grade: "C",
      count: gradeCCount,
      icon: "⚡",
      description: "Medium Severity Debts & Monolith Drift",
      action: async () => {
        await showPagedContent(formatGradeCSection(report), buildGradeCPrompt(report));
      }
    },
    {
      grade: "B",
      count: gradeBCount,
      icon: "ℹ️ ",
      description: "Low Hygiene Issues & Minor Debts",
      action: async () => {
        await showPagedContent(formatGradeBSection(report), buildGradeBPrompt(report));
      }
    },
    {
      grade: "A",
      count: gradeACount,
      icon: "✅",
      description: "Compliant Checks & Passing Pillars",
      action: async () => {
        await showPagedContent(formatGradeASection(report));
      }
    }
  ];

  const createActiveGradeItem = (g) => ({
    key: `grade_${g.grade.toLowerCase()}`,
    grade: g.grade.toLowerCase(),
    tag: resolveGradeBadge(g.grade),
    label: `${g.icon} Grade ${g.grade}: ${g.description} (${g.count} ${g.grade === "A" ? "clean" : "items"})`,
    action: g.action
  });

  const activeGrades = gradeTiers.filter(hasGradeItems).map(createActiveGradeItem);

  const exitAction = {
    key: "exit",
    tag: "\x1b[90m[Exit     ]\x1b[0m",
    label: "🚪 Exit",
    action: async () => {}
  };

  const menuItems = [...actions, ...activeGrades, exitAction];
  const menuOptions = [];
  let currentIndex = 1;

  for (const act of actions) {
    act.index = currentIndex;
    const pad = String(currentIndex).padStart(2, " ");
    menuOptions.push(` ${pad}. ${act.tag} ${act.label}`);
    currentIndex++;
  }

  if (activeGrades.length > 0) {
    menuOptions.push("──────────────────────────────────────────────────────────────────────");
    for (const g of activeGrades) {
      g.index = currentIndex;
      const pad = String(currentIndex).padStart(2, " ");
      menuOptions.push(` ${pad}. ${g.tag} ${g.label}`);
      currentIndex++;
    }
    menuOptions.push("──────────────────────────────────────────────────────────────────────");
  }

  exitAction.index = currentIndex;
  const exitPad = String(currentIndex).padStart(2, " ");
  menuOptions.push(` ${exitPad}. ${exitAction.tag} ${exitAction.label}`);

  renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low);

  const shouldPublish = await confirmAction(
    "Plug your website and publish your audit report to our GitHub Discussions Audits Forum?",
    "Publish Report",
    "Skip to Menu",
    true
  );

  if (shouldPublish) {
    await handleShareToDiscussions(report);
  }

  while (true) {
    renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low);

    if (hasGum()) {
      const choice = gumChoose(menuOptions, "Select an audit section or grade to inspect:");
      const cleanChoice = stripAnsi(choice || "").trim();

      const isSeparator = !choice || cleanChoice.includes("───") || cleanChoice.includes("---");
      if (isSeparator) {
        continue;
      }

      const match = menuItems.find((item) => {
        const prefix = `${item.index}.`;
        if (cleanChoice.startsWith(prefix) || cleanChoice === String(item.index)) return true;
        if (
          item.key === "exit" &&
          (cleanChoice.includes("Exit") || cleanChoice.toLowerCase() === "exit")
        )
          return true;
        if (item.key === "report" && cleanChoice.includes("Report")) return true;
        if (item.key === "share" && cleanChoice.includes("Share")) return true;
        if (item.key === "export" && cleanChoice.includes("Export")) return true;
        if (
          item.key === "install" &&
          (cleanChoice.includes("Install") ||
            cleanChoice.includes("Pre-Commit") ||
            cleanChoice.includes("Workflow"))
        )
          return true;
        if (
          item.key === "upgrade" &&
          (cleanChoice.includes("Upgrade") ||
            cleanChoice.includes("Power Puff") ||
            cleanChoice.includes("Team Power Puff") ||
            cleanChoice.includes("Molecular Rules"))
        )
          return true;
        if (
          item.grade &&
          (cleanChoice.toLowerCase().includes(`grade ${item.grade}`) ||
            cleanChoice.toLowerCase().includes(`grade: ${item.grade}`))
        )
          return true;
        return false;
      });

      const shouldExit = !match || match.key === "exit";
      if (shouldExit) {
        break;
      }

      await match.action();
    } else {
      for (const opt of menuOptions) {
        process.stdout.write(`  ${opt}\n`);
      }
      process.stdout.write("\n");

      const promptMsg = `Select option [1-${exitAction.index}] (default: ${exitAction.index}): `;
      const selection = await promptQuestion(promptMsg);
      const effective = selection.trim().toLowerCase() || String(exitAction.index);

      const isSep = effective.includes("---") || effective.includes("───");
      if (isSep) continue;

      const match = menuItems.find((item) => {
        if (effective === String(item.index)) return true;
        if (item.key === "exit" && (effective === "exit" || effective === String(exitAction.index)))
          return true;
        if (item.key === effective) return true;
        if (item.grade && (effective === item.grade || effective === `grade ${item.grade}`))
          return true;
        return false;
      });

      const shouldExit = !match || match.key === "exit";
      if (shouldExit) {
        break;
      }

      await match.action();
      await promptQuestion("Press Enter to return to menu...");
    }
  }
};
