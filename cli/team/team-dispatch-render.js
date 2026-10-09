/**
 * Chemical X Protocol: renderers for a `chemx team dispatch` plan (#2005).
 * (1) JSON plan, (2) a ready-to-run Claude Code Workflow script, (3) a headless shell
 * script of `claude -p` runs for hosts without Workflow, plus a short text summary.
 * Pure string builders over the plan from buildDispatchPlan (team-dispatch.js).
 */

const TITLE_LIMIT = 100;

const clip = (text, limit) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const isLong = value.length > limit;
  return isLong ? `${value.slice(0, limit - 3)}...` : value;
};

/** POSIX single-quote a string for sh. */
export const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const taskLine = (task) => {
  const files = task.files.join(', ');
  const hasFiles = files !== '';
  const fileText = hasFiles ? `; files: ${files}` : '';
  return `- #${task.id} [${task.needs}] ${clip(task.title, TITLE_LIMIT)}${fileText}`;
};

/**
 * The subagent brief for one batch: identity, owned files, and the claim -> lock -> chemx-only
 * edit -> comment -> friction -> check/test -> done/release loop. Kept compact on purpose.
 */
export const buildAgentPrompt = (batch, plan = {}) => {
  const handle = batch.handle;
  const as = `--as=${handle}`;
  const root = plan.root || '.';
  const hasFrictionParent = Boolean(plan.frictionParent);
  const parentFlag = hasFrictionParent ? ` --parent=${plan.frictionParent}` : '';
  const ownedFiles = batch.files.join(', ');
  const hasOwnedFiles = ownedFiles !== '';
  const ownership = hasOwnedFiles ? `You own only these files: ${ownedFiles}. Touch nothing else.` : 'These tasks name no files: lock each file before you edit it.';
  return [
    `You are ${handle}, a chemx dispatch agent in ${root} (shared checkout: no worktrees, branches or git writes).`,
    `Run chemx from that directory, prefix every chemx command with CHEMX_AGENT_ID=${handle}, and pass ${as} on team commands.`,
    'Tasks (priority order):',
    ...batch.tasks.map(taskLine),
    ownership,
    'For each task:',
    `1. chemx team task claim <id> ${as}`,
    `2. Before the first edit of each file: chemx team lock acquire <file> ${as} --purpose="#<id>"; re-acquire after 4 minutes. If another handle holds it, comment and skip the task.`,
    '3. Read and search only with chemx (read --outline / --symbol / <file>:<a>-<b>, q, q -g); edit only with chemx patch or chemx write. No native Read/Edit/Write/Grep, no cat/sed.',
    `4. Progress: chemx team task comment <id> "<msg>" ${as}`,
    `5. When chemx is awkward, wrong or missing something: chemx team task add "Friction: <what>"${parentFlag} --needs=light --desc="<command and output>" ${as}`,
    '6. chemx check <file> must report zero hazards; run the covering specs with chemx test <specs>.',
    `7. chemx team task done <id> --target=<file> ${as}, then chemx team lock release <file> ${as}.`,
    'Return one line per task: #<id> done|blocked|skipped: <reason>.'
  ].join('\n');
};

const withPrompts = (plan) => plan.batches.map((batch) => ({ ...batch, prompt: buildAgentPrompt(batch, plan) }));

/** (1) The machine-readable plan, each batch carrying its agent prompt. */
export const renderDispatchJson = (plan) => JSON.stringify({ ...plan, batches: withPrompts(plan) }, null, 2);

const SKIPPED_ID_PREVIEW = 8;

const lockedLine = (entry) => `#${entry.id} locked (${entry.lease.file} held by ${entry.lease.lockedBy})`;

const reasonLine = (reason, entries) => {
  const preview = entries.slice(0, SKIPPED_ID_PREVIEW).map((entry) => `#${entry.id}`).join(' ');
  const hidden = entries.length - SKIPPED_ID_PREVIEW;
  const hasHidden = hidden > 0;
  const more = hasHidden ? ` +${hidden}` : '';
  return `${reason} x${entries.length}: ${preview}${more}`;
};

/** Skipped tasks, compact: one line per locked task (who holds what), one counted line per other reason. */
export const summarizeSkipped = (skipped = []) => {
  const locked = skipped.filter((entry) => entry.reason === 'locked');
  const byReason = new Map();
  for (const entry of skipped) {
    const isLocked = entry.reason === 'locked';
    if (isLocked) continue;
    const group = byReason.get(entry.reason) || [];
    group.push(entry);
    byReason.set(entry.reason, group);
  }
  return [...locked.map(lockedLine), ...[...byReason].map(([reason, entries]) => reasonLine(reason, entries))];
};

/**
 * (2) A Claude Code Workflow script. The meta line is a pure literal on line 1; the body
 * pipelines over the batches, one agent per batch with its routed model and effort.
 */
export const renderDispatchWorkflow = (plan) => {
  const batches = withPrompts(plan).map((batch) => ({
    handle: batch.handle,
    model: batch.model,
    effort: batch.effort,
    taskIds: batch.tasks.map((task) => task.id),
    prompt: batch.prompt
  }));
  const taskCount = batches.reduce((count, batch) => count + batch.taskIds.length, 0);
  const summary = `${batches.length} agent(s) over ${taskCount} task(s)`;
  const name = `chemx-dispatch-${plan.scope || 'queue'}`;
  const description = `chemx team dispatch: ${summary}, file-disjoint batches routed by needs tier`;
  const meta = `export const meta = { name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)}, phases: [{ title: 'Dispatch', detail: ${JSON.stringify(summary)} }] };`;
  const skippedComments = summarizeSkipped(plan.skipped).map((line) => `// skipped: ${line}`);
  return [
    meta,
    '// Generated by chemx team dispatch. Each agent claims, locks and edits only through chemx.',
    ...skippedComments,
    `const BATCHES = ${JSON.stringify(batches, null, 2)};`,
    "phase('Dispatch');",
    `log(${JSON.stringify(`Dispatching ${summary}`)});`,
    'const results = await pipeline(BATCHES, (batch) => agent(batch.prompt, { label: batch.handle, phase: \'Dispatch\', model: batch.model, effort: batch.effort }));',
    'return BATCHES.map((batch, index) => ({ handle: batch.handle, taskIds: batch.taskIds, result: results[index] }));',
    ''
  ].join('\n');
};

const logName = (handle) => String(handle).replace(/^@/, '').replace(/[^\w.-]+/g, '-');

/**
 * (3) A headless sh script: one background `claude -p` per batch with its routed model,
 * logs under .chemx/dispatch/. Effort is recorded as a comment (no portable CLI flag).
 */
export const renderDispatchHeadless = (plan) => {
  const lines = withPrompts(plan).flatMap((batch) => [
    `# ${batch.handle}: tasks ${batch.tasks.map((task) => `#${task.id}`).join(' ')}; needs ${batch.needs}; effort ${batch.effort}`,
    `CHEMX_AGENT_ID=${shellQuote(batch.handle)} claude --model ${shellQuote(batch.model)} -p ${shellQuote(batch.prompt)} > ${shellQuote(`.chemx/dispatch/${logName(batch.handle)}.log`)} 2>&1 &`
  ]);
  const skippedComments = summarizeSkipped(plan.skipped).map((line) => `# skipped: ${line}`);
  return [
    '#!/bin/sh',
    '# Generated by chemx team dispatch: one headless Claude Code run per file-disjoint batch.',
    '# The host must allow Bash(chemx ...) for these runs.',
    ...skippedComments,
    `cd ${shellQuote(plan.root || '.')} || exit 1`,
    'mkdir -p .chemx/dispatch',
    ...lines,
    'wait',
    ''
  ].join('\n');
};

/** Short human summary: one line per batch, then skipped tasks. */
export const renderDispatchSummary = (plan) => {
  const totals = plan.totals || {};
  const header = `chemx team dispatch: ${totals.agents ?? 0} agent(s), ${totals.dispatched ?? 0} task(s), ${totals.skipped ?? 0} skipped (routing: ${plan.routingSource})`;
  const batchLines = plan.batches.map((batch) => {
    const ids = batch.tasks.map((task) => `#${task.id}`).join(' ');
    return `  ${batch.handle} ${batch.model}/${batch.effort} [${batch.needs}] ${ids} :: ${batch.files.join(', ')}`;
  });
  const skippedLines = summarizeSkipped(plan.skipped).map((line) => `  skipped ${line}`);
  return [header, ...batchLines, ...skippedLines].join('\n');
};
