const planFixSection = (actions) => {
  const items = [actions.roadmapAction];
  const canCopyPrompt = Boolean(actions.shouldShowPromptAction);
  if (canCopyPrompt) items.push(actions.copyPromptAction);
  const hasHotspots = Boolean(actions.hasHotspots);
  if (hasHotspots) items.push(actions.hotspotsAction);
  items.push(actions.reportAction);
  return items;
};

const planSetupSection = (actions, { guardrailsInstalled, queryIndexInstalled }) => {
  const items = [];
  const isGuardrailsMissing = !guardrailsInstalled;
  if (isGuardrailsMissing) items.push(actions.installAction);
  const isQueryIndexMissing = !queryIndexInstalled;
  if (isQueryIndexMissing) items.push(actions.installSearchAction);
  return items;
};

/**
 * The audit navigator's menu, top to bottom: Fix, Grades (every pillar, as buildActiveGrades orders
 * them, so people can learn the rows), Setup (only missing installs), Track,
 * then Guide / Upgrade / Re-Run / Exit. Pure: it only arranges the rows it is given, so an empty
 * section is returned with no items and the renderer drops it with its separator.
 */
export const planNavigatorSections = ({ actions, grades = [], guardrailsInstalled = false, queryIndexInstalled = false }) => [
  { id: 'fix', items: planFixSection(actions) },
  { id: 'grades', items: grades },
  { id: 'setup', items: planSetupSection(actions, { guardrailsInstalled, queryIndexInstalled }) },
  { id: 'track', items: [actions.progressAction, actions.exportAction, actions.badgeAction, actions.shareAction] },
  { id: 'general', items: [actions.guideAction, actions.upgradeAction, actions.rerunAction, actions.exitAction] }
];
