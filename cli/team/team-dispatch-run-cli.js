/**
 * Chemical X Protocol: the run modes of `chemx team dispatch` (#2494).
 *   --workflow[=<out.js>]   render a run as a Claude Code Workflow script (stdout, or the file given)
 *   --record-run=<name> --workflow-run=<id>   store the host's workflow run id on a recorded run
 *   --find-run=<name>       print the workflow run id (recorded, else found in workflow transcripts)
 * chemx renders the script and records the plan; it never starts the workflow. Without --dry-run a
 * rendered run is recorded in dispatch_runs and its plan is posted to the feed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildRunPlan } from './team-dispatch-v2.js';
import { renderRunScript } from './team-dispatch-script.js';
import { recordRun, recordWorkflowRun, findWorkflowRun, routingOf } from './team-dispatch-runs.js';
import { summarizeSkipped } from './team-dispatch-render.js';

const valueOf = (args, name) => {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
};

const hasFlag = (args, name) => args.includes(`--${name}`);

/** The run-mode options from the raw words after `dispatch`. */
export const parseDispatchRunArgs = (args = []) => ({
  workflow: hasFlag(args, 'workflow') || valueOf(args, 'workflow') !== undefined,
  out: valueOf(args, 'workflow') || '',
  tasks: valueOf(args, 'tasks'),
  runName: valueOf(args, 'run-name'),
  goal: valueOf(args, 'goal'),
  dryRun: hasFlag(args, 'dry-run'),
  recordRun: valueOf(args, 'record-run'),
  workflowRun: valueOf(args, 'workflow-run'),
  findRun: valueOf(args, 'find-run')
});

export const isRunMode = (parsed) => Boolean(parsed.workflow || parsed.recordRun || parsed.findRun);

const write = (isCli, stream, text) => {
  if (isCli) stream.write(`${text}\n`);
};

const routeText = (route) => `${route.model}/${route.effort}`;

/** Human summary of a run plan: header, one line per task by lane, the gate, skipped tasks. */
export const renderRunSummary = (plan) => {
  const header = `chemx team dispatch run ${plan.run} (${plan.template}): ${plan.tasks.length} task(s) in ${plan.lanes.length} lane(s), ${plan.skipped.length} skipped; routing: ${plan.routingSource}; uncommitted-change check: ${plan.dirtyCheck}`;
  const taskLines = plan.lanes.flatMap((lane, index) => lane.map((id) => {
    const task = plan.tasks.find((entry) => entry.id === id);
    return `  lane ${index + 1}: #${id} [${task.needs}] weight ${task.weight} build ${routeText(task.build)}, review ${routeText(task.review)}, repair ${routeText(task.repair)} :: ${task.target}`;
  }));
  const gateLine = `  gate ${plan.gate.handle} ${routeText(plan.gate)}`;
  const skippedLines = summarizeSkipped(plan.skipped).map((line) => `  skipped ${line}`);
  return [header, ...taskLines, gateLine, ...skippedLines].join('\n');
};

/** The dry-run / --json view of a plan: routing and selection without the prompt text. */
export const planView = (plan) => ({
  run: plan.run,
  template: plan.template,
  root: plan.root,
  dispatcher: plan.dispatcher,
  routingSource: plan.routingSource,
  dirtyCheck: plan.dirtyCheck,
  filters: plan.filters,
  tasks: plan.tasks.map((task) => ({ id: task.id, title: task.title, needs: task.needs, target: task.target, weight: task.weight, mechanical: task.mechanical, handle: task.handle, build: task.build, review: task.review, repair: task.repair })),
  lanes: plan.lanes,
  laneWeights: plan.laneWeights,
  gate: plan.gate,
  routing: routingOf(plan),
  peers: plan.peers,
  skipped: plan.skipped,
  totals: plan.totals
});

const writeScript = (out, script) => {
  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, script);
  return file;
};

const nextSteps = (plan, scriptPath, recorded) => {
  const where = scriptPath ? `Wrote ${scriptPath}.` : 'Script printed above.';
  const record = recorded ? `Recorded run ${plan.run} in dispatch_runs and posted the plan to the feed.` : 'Dry run: nothing recorded, nothing posted.';
  return [
    `${where} chemx does not run it: start it with the Workflow tool (scriptPath${scriptPath ? ` ${scriptPath}` : ''}).`,
    record,
    `After the run: chemx team dispatch --find-run=${plan.run}, then chemx team audit-run --run=<workflow run id>.`
  ].join('\n');
};

const runWorkflow = (db, flags, parsed, isCli, cwd) => {
  const plan = buildRunPlan(db, {
    root: flags.root || cwd,
    agentId: flags.as,
    tasks: parsed.tasks,
    needs: flags.needs,
    parent: flags.parent,
    repo: flags.repo,
    rule: flags.rule,
    limit: flags.limit,
    maxAgents: flags.maxAgents,
    runName: parsed.runName,
    goal: parsed.goal
  });
  const script = renderRunScript(plan);
  const hasScript = Boolean(script);
  const scriptPath = hasScript && parsed.out ? writeScript(parsed.out, script) : null;
  const shouldRecord = hasScript && !parsed.dryRun;
  const recorded = shouldRecord ? recordRun(db, plan, { scriptPath }) : null;
  const result = { dryRun: parsed.dryRun, scriptPath, recorded: Boolean(recorded), plan: planView(plan) };
  const isJson = Boolean(flags.isJson || flags.json);
  if (isJson) {
    write(isCli, process.stdout, JSON.stringify(result, null, 2));
    return { ...result, script };
  }
  const printScript = hasScript && !scriptPath;
  if (printScript) write(isCli, process.stdout, script);
  const tail = hasScript ? nextSteps(plan, scriptPath, Boolean(recorded)) : 'Nothing to dispatch: no task passed selection, so no script was rendered.';
  const summary = `${renderRunSummary(plan)}\n${tail}`;
  write(isCli, printScript ? process.stderr : process.stdout, summary);
  return { ...result, script, summary };
};

const runRecord = (db, parsed, isCli) => {
  const result = recordWorkflowRun(db, parsed.recordRun, parsed.workflowRun);
  const isOk = result.ok;
  const message = isOk ? `Recorded: dispatch run ${result.run} is workflow run ${result.workflowRunId}.` : `x Not recorded (${result.reason}). Usage: chemx team dispatch --record-run=<name> --workflow-run=<id>; the run must have been rendered without --dry-run.`;
  write(isCli, isOk ? process.stdout : process.stderr, message);
  const shouldFail = !isOk && isCli;
  if (shouldFail) process.exitCode = 1;
  return result;
};

const runFind = (db, parsed, isCli) => {
  const found = findWorkflowRun(parsed.findRun, { db });
  const isFound = Boolean(found);
  const detail = found?.dir ? ` (matched a transcript in ${found.dir}; a match is evidence, not proof)` : ' (recorded)';
  const message = isFound ? `${found.id}${detail}` : `x No workflow run found for dispatch run ${parsed.findRun}: none recorded, and no recent workflow transcript names it.`;
  write(isCli, isFound ? process.stdout : process.stderr, message);
  const shouldFail = !isFound && isCli;
  if (shouldFail) process.exitCode = 1;
  return found ? { ...found, run: parsed.findRun } : { run: parsed.findRun, id: null };
};

/** Entry for the run modes; flags are the parsed team flags (root, as, needs, limit, maxAgents, ...). */
export const handleDispatchRun = (db, flags, parsed, isCli = false, cwd = process.cwd()) => {
  const isFind = Boolean(parsed.findRun);
  if (isFind) return runFind(db, parsed, isCli);
  const isRecord = Boolean(parsed.recordRun);
  if (isRecord) return runRecord(db, parsed, isCli);
  return runWorkflow(db, flags, parsed, isCli, cwd);
};
