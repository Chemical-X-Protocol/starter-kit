/**
 * The briefs, kinds and task files of the chemx_team_task MCP tool (K14, #6759), kept out of
 * tools-team-tasks.js. The same cores as the CLI: task-brief-store.js and task-add-from-file.js.
 */
import { getTask } from '../team/team-db-tasks.js';
import { runBriefRequest, describeBriefResult, checkBriefText, readBriefSource } from '../team/task-brief-store.js';
import { addTasksFromFile, describeAdded, describeDryRun, describeProblems } from '../team/task-add-from-file.js';
import { registerAgent } from '../team/team-db-agents.js';

/** `action: 'create'` with `fromFile`: the whole file in one transaction; `dryRun` checks it and writes nothing. */
export const createFromFile = (ctx, args, cwd) => {
  const isStdin = args.fromFile === '-';
  if (isStdin) return { error: 'fromFile cannot be "-": standard input carries the MCP protocol; give a path', refused: true };
  const result = addTasksFromFile(ctx, { file: args.fromFile, cwd, authorHandle: args.agentId || '@agent', dryRun: Boolean(args.dryRun) });
  if (result.error) return { error: result.error, refused: true };
  if (result.problems) return { error: 'invalid task file', refused: true, problems: result.problems, ack: describeProblems(result).join('\n') };
  if (result.dryRun) return { dryRun: true, plan: result.plan, ack: describeDryRun(result).join('\n') };
  return { added: result.added, refs: result.refs, ack: describeAdded(result).join('\n') };
};

/** `action: 'brief'`: read (no source), set (briefText | briefFile) or clear (clear: true) a task's long brief. */
export const runBriefAction = (ctx, args, cwd) => {
  const taskId = args.taskId ?? args.id;
  const task = taskId ? getTask(ctx.db, taskId) : null;
  if (!task) return { error: `Task #${taskId} not found` };
  const authorId = args.agentId || '@agent';
  const writes = args.clear || args.briefText !== undefined || args.briefFile !== undefined;
  if (writes) registerAgent(ctx.db, { id: authorId, role: 'contributor' });
  const result = runBriefRequest(ctx.db, task, { clear: args.clear, text: args.briefText, file: args.briefFile, authorId }, { cwd });
  if (result.error) return { error: result.error, refused: true };
  const isRead = result.action === 'read';
  return isRead ? { task_id: result.taskId, chars: result.chars, brief: result.brief } : { task_id: result.taskId, action: result.action, chars: result.chars, ack: describeBriefResult(result) };
};

/** The brief text for `action: 'create'`: briefText, or briefFile read relative to cwd; '' when neither is given. */
export const readCreateBrief = (args, cwd) => {
  const hasText = args.briefText !== undefined;
  const hasFile = Boolean(args.briefFile);
  if (hasText) return checkBriefText(args.briefText);
  return hasFile ? readBriefSource({ file: args.briefFile }, { cwd }) : { text: '' };
};
