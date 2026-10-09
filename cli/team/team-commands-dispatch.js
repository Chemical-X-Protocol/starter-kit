/**
 * Chemical X Protocol: `chemx team dispatch [options]`.
 * Generates and displays a model/effort-tiered subagent dispatch plan.
 */
import { buildDispatchPlan } from './team-dispatch.js';
import {
  renderDispatchJson,
  renderDispatchWorkflow,
  renderDispatchHeadless,
  renderDispatchSummary
} from './team-dispatch-render.js';
import { DEFAULT_MAX_AGENTS, DEFAULT_MAX_TASKS_PER_AGENT } from './team-dispatch-batches.js';

const DISPATCH_USAGE = [
  'Usage: chemx team dispatch [filters] [capacity] [--json | --workflow | --headless]',
  '  Plans file-disjoint agent batches for queued tasks and routes each batch by its needs tier.',
  '  Filters:  --rule=<RULE> --needs=light|standard|deep --parent=<id> --repo=<name> --limit=<n>',
  `  Capacity: --max-agents=<n> (default ${DEFAULT_MAX_AGENTS}) --per-agent=<n> tasks per agent (default ${DEFAULT_MAX_TASKS_PER_AGENT})`,
  '  Output:   summary (default), --json plan, --workflow Claude Code Workflow script, --headless claude -p commands'
].join('\n');

export const handleDispatchCommand = (db, flags = {}, isCli = false, cwd = process.cwd()) => {
  const isHelp = Boolean(flags.help);
  if (isHelp) {
    if (isCli) process.stdout.write(`${DISPATCH_USAGE}\n`);
    return { usage: DISPATCH_USAGE };
  }

  const plan = buildDispatchPlan(db, {
    root: cwd,
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

  const isWorkflow = Boolean(flags.workflow);
  if (isWorkflow) {
    const wf = renderDispatchWorkflow(plan);
    if (isCli) process.stdout.write(`${wf}\n`);
    return { workflow: wf, plan };
  }

  const isHeadless = Boolean(flags.headless);
  if (isHeadless) {
    const sh = renderDispatchHeadless(plan);
    if (isCli) process.stdout.write(`${sh}\n`);
    return { headless: sh, plan };
  }

  const summary = renderDispatchSummary(plan);
  if (isCli) process.stdout.write(`${summary}\n`);
  return { summary, plan };
};
