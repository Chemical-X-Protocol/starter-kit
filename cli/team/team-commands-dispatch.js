/**
 * Chemical X Protocol: `chemx team dispatch [options]`.
 * Plans model/effort-routed work for queued tasks. --workflow renders a whole run (build, review,
 * repair, gate) as a Claude Code Workflow script (team-dispatch-run-cli.js, #2494); without it the
 * command prints the batch plan (summary, --json, --headless).
 */
import { buildDispatchPlan } from './team-dispatch.js';
import {
  renderDispatchJson,
  renderDispatchWorkflow,
  renderDispatchHeadless,
  renderDispatchSummary
} from './team-dispatch-render.js';
import { DEFAULT_MAX_AGENTS, DEFAULT_MAX_TASKS_PER_AGENT } from './team-dispatch-batches.js';
import { parseDispatchRunArgs, isRunMode, handleDispatchRun } from './team-dispatch-run-cli.js';

const DISPATCH_USAGE = [
  'Usage: chemx team dispatch [filters] [capacity] [--json | --headless]',
  '       chemx team dispatch --workflow[=<out.js>] [--tasks=<ids>] [filters] [--limit=N] [--max-agents=N] [--run-name=<name>] [--goal=<text>] [--dry-run] [--json]',
  '       chemx team dispatch --find-run=<name> | --record-run=<name> --workflow-run=<id>',
  '  Plans file-disjoint agent work for queued tasks and routes each task by its needs tier.',
  '  Filters:  --rule=<RULE> --needs=light|standard|deep --parent=<id> --repo=<path> --limit=<n>',
  '  Files are relative to the team db root; a task whose target leaves that root is skipped (target_outside_root).',
  `  Capacity: --max-agents=<n> (default ${DEFAULT_MAX_AGENTS}) --per-agent=<n> tasks per agent (default ${DEFAULT_MAX_TASKS_PER_AGENT}; batch plan only)`,
  '  Output:   summary (default), --json plan, --headless claude -p commands',
  '  --workflow renders a Claude Code Workflow script: one builder per task (target_path plus its extra_files; untargeted tasks are',
  '    skipped as needs_scoping), a reviewer on the same tier, a light repair when the review finds issues, and a light',
  '    gate that closes reviewed tasks and runs chemx team audit-run. Tasks that share a file run one after another in',
  '    one lane; --max-agents caps the lanes running at once. chemx renders the script; the host runs it (Workflow tool',
  '    scriptPath). Without --dry-run the run is recorded in dispatch_runs and the plan is posted to the feed.',
  '    Selection skips tasks that are claimed, have unmet dependencies, or whose target is leased by another handle or',
  '    has uncommitted changes the dispatcher does not lease. The same db state renders the same script, byte for byte.',
  '  --find-run prints the workflow run id: recorded, else the newest workflow transcript naming the run (evidence, not proof).'
].join('\n');

export const handleDispatchCommand = (db, flags = {}, isCli = false, cwd = process.cwd()) => {
  const isHelp = Boolean(flags.help);
  if (isHelp) {
    if (isCli) process.stdout.write(`${DISPATCH_USAGE}\n`);
    return { usage: DISPATCH_USAGE };
  }

  const rawArgs = flags.rawArgs || [];
  const runArgs = parseDispatchRunArgs(rawArgs);
  const isRun = isRunMode(runArgs);
  if (isRun) return handleDispatchRun(db, flags, runArgs, isCli, cwd);

  // flags.root is the team db's root (team-commands.js), so every file is root-relative.
  const plan = buildDispatchPlan(db, {
    root: flags.root || cwd,
    limit: flags.limit ? Number(flags.limit) : undefined,
    parent: flags.parent,
    rule: flags.rule,
    needs: flags.needs,
    repo: flags.repo,
    maxAgents: flags.maxAgents,
    maxTasksPerAgent: flags.maxTasksPerAgent
  });

  const isJson = Boolean(flags.isJson || flags.json);
  if (isJson) {
    const jsonText = renderDispatchJson(plan);
    if (isCli) process.stdout.write(`${jsonText}\n`);
    return JSON.parse(jsonText);
  }

  // Programmatic only: the batch-level script from #2005. The CLI's --workflow renders a full run instead.
  const isBatchWorkflow = Boolean(flags.workflow);
  if (isBatchWorkflow) {
    const wf = renderDispatchWorkflow(plan);
    if (isCli) process.stdout.write(`${wf}\n`);
    return { workflow: wf, plan };
  }

  const isHeadless = Boolean(flags.headless) || rawArgs.includes('--headless');
  if (isHeadless) {
    const sh = renderDispatchHeadless(plan);
    if (isCli) process.stdout.write(`${sh}\n`);
    return { headless: sh, plan };
  }

  const summary = renderDispatchSummary(plan);
  if (isCli) process.stdout.write(`${summary}\n`);
  return { summary, plan };
};
