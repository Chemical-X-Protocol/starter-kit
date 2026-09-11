import {
  hasGum,
  gumChoose,
  promptQuestion,
  stripAnsi,
  confirmAction
} from "./terminal.js";
import { saveAuditSnapshot, groupViolationsBySeverity } from "./audit.js";
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
  resolveHotspotGrade,
  resolveContextGrade
} from "./navigator-grades.js";
export { extractPromptFromContent, showPagedContent } from "./navigator-paged.js";
export { showConversionMenu } from "./navigator-conversion.js";
export { handleShareToDiscussions } from "./navigator-share.js";
export { formatButtonTag, buildNavigatorMenu } from "./navigator-menu.js";
export { renderDashboardBanner } from "./navigator-banner.js";

export const runInteractiveAuditNavigator = async (report, onScaffold = null) => {
  saveAuditSnapshot(report);
  const { metrics, health, violations, contextAnalysis } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const highMediumCount = high.length + medium.length;

  const activeGrades = buildActiveGrades(report);
  const actions = buildDashboardActionGroups({ report, onScaffold });

  renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low, contextAnalysis);

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
    renderDashboardBanner(health, metrics, violations, critical, highMediumCount, low, contextAnalysis);

    const guardrailsInstalled = areGuardrailsInstalled(process.cwd());
    const topActions = [];
    if (!guardrailsInstalled) {
      topActions.push(actions.installAction);
    }
    topActions.push(actions.upgradeAction, actions.reportAction);

    const midActions = [actions.shareAction, actions.progressAction, actions.exportAction];
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
