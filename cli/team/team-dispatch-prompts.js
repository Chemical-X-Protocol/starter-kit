/**
 * Chemical X Protocol: renders the builder, reviewer, repair and gate prompts of a dispatch run (#2494)
 * from the versioned templates in dispatch-templates/. Every prompt starts and ends with the authority
 * line (#2508). Task text from the db is inserted as data: a placeholder inside it is never expanded,
 * and the script's run-time markers are defused so a description cannot capture a result.
 */
import path from 'node:path';
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
// "Acceptance:" at a line start or after a sentence end, so inline descriptions match too.
const ACCEPTANCE_HEADING = /(?:^|[.\n]\s*)acceptance(?:[ \t]+criteria)?[ \t]*(?:[:-]\s*|(?=\n))/i;
const SPEC_LINE = /\n[ \t]*spec[ \t]*:/i;

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

const repoOf = (task) => task.repo || '.';
// Files and targets in a plan are root-relative; an agent works from its task's repo directory (#4522).
const inRepo = (task, file) => (repoOf(task) === '.' ? file : path.posix.relative(repoOf(task), file));
const repoView = (task) => ({
  ...task,
  files: task.files.map((file) => inRepo(task, file)),
  extraFiles: (task.extraFiles || []).map((file) => inRepo(task, file)),
  target: task.target ? inRepo(task, task.target) : task.target
});
const projectDir = (plan, task) => path.resolve(plan.root, repoOf(task));

const snapshotLine = (task) => {
  const rules = task.snapshot?.rules;
  const hasRules = typeof rules === 'string' && rules !== '';
  if (!hasRules) return '';
  const lines = task.snapshot.violationLines ? ` at line(s) ${task.snapshot.violationLines}` : '';
  return `\nAudit snapshot when the task was filed: ${asData(rules)}${lines}. Re-check with chemx check ${task.target}; the file may have changed since.`;
};

/** The acceptance section of the description (from "Acceptance:" up to a "Spec:" line), else a stated default. */
export const acceptanceOf = (task) => {
  const text = asData(task.description);
  const match = ACCEPTANCE_HEADING.exec(text);
  const rest = match ? text.slice(match.index + match[0].length) : '';
  const stop = rest.search(SPEC_LINE);
  const section = (stop >= 0 ? rest.slice(0, stop) : rest).trim();
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

const pathNoteFor = (plan, task) => (repoOf(task) === '.' ? '' : ` Paths in the peer list and the run list are relative to the checkout root ${plan.root}; your own files are relative to your Project directory.`);

const peersFor = (plan, task) => fillTemplate(PEERS, {
  pathNote: pathNoteFor(plan, task),
  peerLines: plan.peers.length > 0 ? plan.peers.join('\n') : '- none',
  run: plan.run,
  laneCount: plan.lanes.length,
  runLines: runLines(plan),
  files: task.files.join(', ')
});

// Scratch dir is derived from the run and handle (no plan.scratchDir yet); the text states a policy, not enforcement (#4464).
const scratchDirFor = (plan, handle) => `/tmp/chemx-${plan.run}/${handle}/`;

const WAITING_SCRATCH = (scratchDir) => [
  'WAITING: to wait for a task, a lock or a verify run, use chemx wait --task=<id> | --lock-free=<file> | --verify-idle --timeout=<t>; check state with chemx status. Do not use Monitor, sleep, until or setTimeout loops.',
  `SCRATCH: put temporary files only under ${scratchDir} (never the user's home or tracked repo paths) and delete them when done. This is a policy, not enforced by chemx.`
].join('\n');

const protocolFor = (plan, task, handle, claimStep) => `${fillTemplate(PROTOCOL, { root: projectDir(plan, task), handle, taskId: task.id, claimStep })}\n${WAITING_SCRATCH(scratchDirFor(plan, handle))}`;

// Empty without extras, so a task with only a target renders the same text as before (#4426).
const extraFilesNote = (task) => {
  const extras = Array.isArray(task.extraFiles) ? task.extraFiles : [];
  return extras.length > 0 ? `\nYou may also edit: ${extras.join(', ')} (lock each before its first edit).` : '';
};

/** { build, review, repair } prompts for one task of the plan. */
export const renderTaskPrompts = (rootTask, plan) => {
  const task = repoView(rootTask);
  const authority = authorityFor(plan, `task #${task.id}`);
  const shared = { authority, taskId: task.id, run: plan.run, version: TEMPLATE_VERSION, title: asData(task.title), files: task.files.join(', '), acceptance: acceptanceOf(task) };
  const claimStep = fillTemplate(CLAIM_STEP, { taskId: task.id, handle: task.handle });
  const handoffStep = fillTemplate(HANDOFF_STEP, { taskId: task.id, handle: task.repairer, builder: task.handle });
  const peers = peersFor(plan, task);
  const description = `${clipDescription(task)}${snapshotLine(task)}`;
  return {
    build: fillTemplate(BUILDER, {
      ...shared,
      handle: task.handle,
      needs: task.needs,
      extraFilesNote: extraFilesNote(task),
      protocol: protocolFor(plan, task, task.handle, claimStep),
      peers,
      description
    }),
    review: fillTemplate(REVIEWER, { ...shared, handle: task.reviewer, root: projectDir(plan, task), builder: task.handle, description }),
    repair: fillTemplate(REPAIR, {
      ...shared,
      handle: task.repairer,
      protocol: protocolFor(plan, task, task.repairer, handoffStep),
      peers,
      target: task.target,
      description
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
