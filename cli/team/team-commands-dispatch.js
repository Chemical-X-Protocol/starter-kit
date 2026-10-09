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

export const handleDispatchCommand = (db, flags = {}, isCli = false, cwd = process.cwd()) => {
  const plan = buildDispatchPlan(db, {
    root: cwd,
    limit: flags.limit ? Number(flags.limit) : undefined,
    parent: flags.parent,
    rule: flags.rule,
    needs: flags.needs,
    repo: flags.repo
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
