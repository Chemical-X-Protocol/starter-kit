import { resolveGradeBadge } from './navigator-grades.js';
import { showPagedContent } from './navigator-paged.js';

const hasOpenItems = (grade) => (grade.violations || 0) > 0;
const isCleanGrade = (grade) => !hasOpenItems(grade);

const formatCleanPillarsContent = (cleanGrades) => {
  const lines = cleanGrades.map((grade) => `  \x1b[32m✓\x1b[0m ${grade.name}`);
  return [`\n\x1b[1m\x1b[32mClean pillars (no open items)\x1b[0m\n`, ...lines].join('\n');
};

/** One row standing in for every pillar with zero items; selecting it lists their names. */
export const buildCleanPillarsRow = (cleanGrades) => {
  const count = cleanGrades.length;
  const noun = count === 1 ? 'pillar' : 'pillars';
  const handleCleanPillarsAction = async () => {
    await showPagedContent(formatCleanPillarsContent(cleanGrades));
  };
  return {
    key: 'clean_pillars',
    tag: resolveGradeBadge('A+', 11),
    label: `✓ ${count} ${noun} clean`,
    action: handleCleanPillarsAction
  };
};

const planFixSection = (actions) => {
  const items = [actions.roadmapAction];
  const canCopyPrompt = Boolean(actions.shouldShowPromptAction);
  if (canCopyPrompt) items.push(actions.copyPromptAction);
  const hasHotspots = Boolean(actions.hasHotspots);
  if (hasHotspots) items.push(actions.hotspotsAction);
  items.push(actions.reportAction);
  return items;
};

const planGradesSection = (grades) => {
  const flagged = grades.filter(hasOpenItems);
  const clean = grades.filter(isCleanGrade);
  const hasCleanPillars = clean.length > 0;
  if (!hasCleanPillars) return flagged;
  return [...flagged, buildCleanPillarsRow(clean)];
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
 * The audit navigator's menu, top to bottom: Fix, Grades, Setup (only missing installs), Track,
 * then Guide / Upgrade / Re-Run / Exit. Pure: it only arranges the rows it is given, so an empty
 * section is returned with no items and the renderer drops it with its separator.
 */
export const planNavigatorSections = ({ actions, grades = [], guardrailsInstalled = false, queryIndexInstalled = false }) => [
  { id: 'fix', items: planFixSection(actions) },
  { id: 'grades', items: planGradesSection(grades) },
  { id: 'setup', items: planSetupSection(actions, { guardrailsInstalled, queryIndexInstalled }) },
  { id: 'track', items: [actions.progressAction, actions.exportAction, actions.badgeAction, actions.shareAction] },
  { id: 'general', items: [actions.guideAction, actions.upgradeAction, actions.rerunAction, actions.exitAction] }
];
