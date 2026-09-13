import fs from "node:fs";
import {
  hasGum,
  gumChoose,
  promptQuestion,
  stripAnsi,
  confirmAction
} from "./terminal.js";
import { runAudit, saveAuditSnapshot, groupViolationsBySeverity } from "./audit.js";
import { areGuardrailsInstalled } from "./installer.js";
import { renderDashboardBanner } from "./navigator-banner.js";
import {
  formatButtonTag,
  buildNavigatorMenu,
  matchGumChoice,
  matchFallbackChoice
} from "./navigator-menu.js";
import {
  buildActiveGrades,
  buildDashboardActionGroups
} from "./navigator-actions.js";
import { handleShareToDiscussions } from "./navigator-share.js";

export {
  resolveGradeColor,
  resolveGradeBadge,
  resolveHealthHearts,
  resolveCriticalGrade,
  resolveHighMedGrade,
  resolveLowGrade,
  resolvePillarGrade,
  resolveIndividualPillarGrade,
  resolvePillarRiskWeight,
  resolveHotspotGrade,
  resolveContextGrade,
  resolveAiSlopGrade
} from "./navigator-grades.js";
export { extractPromptFromContent, showPagedContent } from "./navigator-paged.js";
export { showConversionMenu } from "./navigator-conversion.js";
export { handleShareToDiscussions } from "./navigator-share.js";
export { formatButtonTag, buildNavigatorMenu } from "./navigator-menu.js";
export { renderDashboardBanner } from "./navigator-banner.js";

export const runInteractiveAuditNavigator = async (initialReport, onScaffold = null, onReAudit = null) => {
  let report = initialReport;
  saveAuditSnapshot(report);
  let { metrics, health, violations, contextAnalysis, aiSlop } = report;
  let { critical, high, medium, low } = groupViolationsBySeverity(violations);
  let highMediumCount = high.length + medium.length;

  const handleRerun = async () => {
    process.stdout.write("\n\x1b[36m⟳ Re-running architectural audit...\x1b[0m\n");
    if (onReAudit) {
      report = await onReAudit();
    } else {
      const targetDir = report?.targetDir || (fs.existsSync("src") ? "src" : ".");
      const options = report?.options || {};
      report = runAudit(targetDir, options);
    }
    saveAuditSnapshot(report);

    metrics = report.metrics;
    health = report.health;
    violations = report.violations;
    contextAnalysis = report.contextAnalysis;
    aiSlop = report.aiSlop;

    const grouped = groupViolationsBySeverity(violations);
    critical = grouped.critical;
    high = grouped.high;
    medium = grouped.medium;
    low = grouped.low;
    highMediumCount = high.length + medium.length;

    activeGrades = buildActiveGrades(report);
    actions = buildDashboardActionGroups({ report, onScaffold, onRerun: handleRerun });

    process.stdout.write(`\x1b[32m✔ Audit refreshed: ${health.score}/100 [Grade: ${health.grade}]\x1b[0m\n\n`);
  };

  let activeGrades = buildActiveGrades(report);
  let actions = buildDashboardActionGroups({ report, onScaffold, onRerun: handleRerun });

  renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low, contextAnalysis, aiSlop, { interactive: true });

  const shouldPublish = await confirmAction(
    "Publish audit report and promote your project to our GitHub Discussions Audits Forum?",
    "Publish Report",
    "Skip to Menu",
    true
  );

  if (shouldPublish) {
    await handleShareToDiscussions(report);
  }

  while (true) {
    renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low, contextAnalysis, aiSlop, { interactive: true, clear: true });

    const guardrailsInstalled = areGuardrailsInstalled(process.cwd());
    const topActions = [];
    if (!guardrailsInstalled) {
      topActions.push(actions.installAction);
    }
    topActions.push(actions.roadmapAction, actions.upgradeAction, actions.reportAction, actions.rerunAction);

    const midActions = [];
    if (actions.hasHotspots) {
      midActions.push(actions.hotspotsAction);
    }
    midActions.push(actions.shareAction, actions.progressAction, actions.exportAction, actions.badgeAction);
    const bottomActions = [];
    if (actions.shouldShowPromptAction) {
      bottomActions.push(actions.copyPromptAction);
    }
    bottomActions.push(actions.exitAction);

    const { menuItems, menuOptions } = buildNavigatorMenu(
      topActions,
      activeGrades,
      midActions,
      bottomActions
    );

    if (hasGum()) {
      const choice = gumChoose(menuOptions, "Select an audit section or grade to inspect:");
      const cleanChoice = stripAnsi(choice || "").trim();

      const isSeparator = !choice || cleanChoice.includes("───") || cleanChoice.includes("---");
      if (isSeparator) {
        continue;
      }

      const match = matchGumChoice(cleanChoice, menuItems);
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

      const exitIndex = actions.exitAction.index;
      const promptMsg = `Select option [1-${exitIndex}] (default: ${exitIndex}): `;
      const selection = await promptQuestion(promptMsg);
      const effective = selection.trim().toLowerCase() || String(exitIndex);

      const isSep = effective.includes("---") || effective.includes("───");
      if (isSep) continue;

      const match = matchFallbackChoice(effective, menuItems, exitIndex);
      const shouldExit = !match || match.key === "exit";
      if (shouldExit) {
        break;
      }

      await match.action();
      await promptQuestion("Press Enter to return to menu...");
    }
  }
};
