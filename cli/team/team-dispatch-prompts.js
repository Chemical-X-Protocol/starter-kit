/**
 * Chemical X Protocol: renders the builder, reviewer, repair and gate prompts of a dispatch run (#2494)
 * from the versioned templates in dispatch-templates/. Every prompt starts and ends with the authority
 * line (#2508). Task text from the db is inserted as data: a placeholder inside it is never expanded,
 * and the script's run-time markers are defused so a description cannot capture a result.
 */
import {
  TEMPLATE_VERSION,
  AUTHORITY,
  CLAIM_STEP,
  HANDOFF_STEP,
  PROTOCOL,
  PEERS,
  BUILDER,
  REVIEWER,
  REPAIR,
  GATE
} from './dispatch-templates/dispatch-v1.js';

const DESCRIPTION_LIMIT = 6000;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const RUNTIME_MARKER = /__(BUILD_RESULT|ISSUES|CLOSE_LIST|RESULTS)__/g;
const ACCEPTANCE_HEADING = /^[ \t]*acceptance\b[ \t]*(?:criteria)?[ \t]*[:-]?[ \t]*/im;

/** Fills {{name}} placeholders in one pass; a placeholder without a value throws (never renders empty). */
export const fillTemplate = (template, vars) => template.replace(PLACEHOLDER, (match, name) => {
  const hasValue = Object.hasOwn(vars, name) && vars[name] !== undefined && vars[name] !== null;
  if (!hasValue) throw new Error(`dispatch template ${TEMPLATE_VERSION}: no value for {{${name}}}`);
  return String(vars[name]);
});

const asData = (text) => String(text || '').replace(RUNTIME_MARKER, '$1');

const clipDescription = (task) => {
  const text = asData(task.description).trim();
  const isLong = text.length > DESCRIPTION_LIMIT;
  const clipped = isLong ? `${text.slice(0, DESCRIPTION_LIMIT)}\n[clipped: read the rest with chemx team task show ${task.id}]` : text;
  return clipped || '(no description: the title is the task)';
};

const snapshotLine = (task) => {
  const rules = task.snapshot?.rules;
  const hasRules = typeof rules === 'string' && rules !== '';
  if (!hasRules) return '';
  const lines = task.snapshot.violationLines ? ` at line(s) ${task.snapshot.violationLines}` : '';
  return `\nAudit snapshot when the task was filed: ${asData(rules)}${lines}. Re-check with chemx check ${task.target}; the file may have changed since.`;
};

/** The acceptance section of the description (from a line starting "Acceptance"), else a stated default. */
export const acceptanceOf = (task) => {
  const text = asData(task.description);
  const match = ACCEPTANCE_HEADING.exec(text);
  const section = match ? text.slice(match.index + match[0].length).trim() : '';
  const hasSection = section !== '';
  if (hasSection) return section.slice(0, DESCRIPTION_LIMIT);
  return `the task above is done as described; chemx check shows 0 hazards on ${task.files.join(', ')}; the covering specs pass.`;
};

const authorityFor = (plan, scope) => {
  const hasGoal = plan.goal !== '';
  const goal = hasGoal ? `the user set the goal "${asData(plan.goal)}"; ` : '';
  return fillTemplate(AUTHORITY, { goal, dispatcher: plan.dispatcher, scope, run: plan.run });
};

const runLines = (plan) => plan.lanes.flatMap((lane, laneIndex) => lane.map((id) => {
  const task = plan.tasks.find((entry) => entry.id === id);
  return `- #${id} (lane ${laneIndex + 1}) ${task.handle}: ${task.files.join(', ')}`;
})).join('\n');

const peersFor = (plan, task) => fillTemplate(PEERS, {
  peerLines: plan.peers.length > 0 ? plan.peers.join('\n') : '- none',
  run: plan.run,
  laneCount: plan.lanes.length,
  runLines: runLines(plan),
  files: task.files.join(', ')
});

const protocolFor = (plan, task, handle, claimStep) => fillTemplate(PROTOCOL, { root: plan.root, handle, taskId: task.id, claimStep });

/** { build, review, repair } prompts for one task of the plan. */
export const renderTaskPrompts = (task, plan) => {
  const authority = authorityFor(plan, `task #${task.id}`);
  const shared = { authority, taskId: task.id, run: plan.run, version: TEMPLATE_VERSION, title: asData(task.title), files: task.files.join(', '), acceptance: acceptanceOf(task) };
  const claimStep = fillTemplate(CLAIM_STEP, { taskId: task.id, handle: task.handle });
  const handoffStep = fillTemplate(HANDOFF_STEP, { taskId: task.id, handle: task.repairer, builder: task.handle });
  const peers = peersFor(plan, task);
  return {
    build: fillTemplate(BUILDER, {
      ...shared,
      handle: task.handle,
      needs: task.needs,
      protocol: protocolFor(plan, task, task.handle, claimStep),
      peers,
      description: `${clipDescription(task)}${snapshotLine(task)}`
    }),
    review: fillTemplate(REVIEWER, { ...shared, handle: task.reviewer, root: plan.root, builder: task.handle }),
    repair: fillTemplate(REPAIR, {
      ...shared,
      handle: task.repairer,
      protocol: protocolFor(plan, task, task.repairer, handoffStep),
      peers,
      target: task.target
    })
  };
};

/** The gate prompt: close reviewed tasks, find and record the workflow run, audit it, post a summary. */
export const renderGatePrompt = (plan) => fillTemplate(GATE, {
  authority: authorityFor(plan, 'the gate of this run'),
  handle: plan.gate.handle,
  run: plan.run,
  root: plan.root
});
