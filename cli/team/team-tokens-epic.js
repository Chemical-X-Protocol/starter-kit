/**
 * Chemical X Protocol: `chemx team tokens --epic <id> [--json]` (#6760, K15).
 * Rolls the board's recorded usage up over an epic's children, recursively: prompt, completion and
 * cached tokens, cost and wall time, one line per child and a total. A child's own telemetry is used;
 * a child with none takes the run usage imported for it (task_usage); a child with neither is unknown,
 * shown as a dash and counted apart, never as zero.
 * Wall time is last update minus creation: the board keeps no claim time, so queue time counts too.
 */
import { optionOf } from './team-commands-tokens.js';
import { parseTaskNumber } from './task-ref.js';
import { fmtInt, fmtUsd } from './usage-render.js';

const HOUR_MS = 3600 * 1000;
const COLUMNS = 'id, title, status, parent_id, assigned_agent_id, created_at, updated_at, prompt_tokens, completion_tokens, cached_tokens, total_tokens, cost_usd, telemetry_source';

/** Parse `--epic <id>` out of the args after `tokens`; null when --epic is absent. */
export const parseEpicArgs = (args = []) => {
  const raw = optionOf(args, 'epic');
  const isAbsent = !args.some((a) => a === '--epic' || a.startsWith('--epic='));
  if (isAbsent) return null;
  const epic = parseTaskNumber(raw);
  const hasRun = args.some((a) => a === '--run' || a.startsWith('--run='));
  const isBadId = epic === null;
  if (hasRun) return { error: 'give --epic or --run, not both' };
  return isBadId ? { error: `--epic needs a task id (for example --epic 6745), got "${raw ?? ''}"` } : { epic };
};

const rowsWithParents = (db, parentIds) => {
  const marks = parentIds.map(() => '?').join(', ');
  return db.prepare(`SELECT ${COLUMNS} FROM agent_tasks WHERE parent_id IN (${marks}) ORDER BY id`).all(...parentIds);
};

// Breadth-first from the epic; a task met twice (a parent cycle) is taken once, so the walk always ends.
const collectByParent = (db, epicId) => {
  const byParent = new Map();
  const seen = new Set([epicId]);
  let frontier = [epicId];
  while (frontier.length > 0) {
    const fresh = rowsWithParents(db, frontier).filter((row) => !seen.has(row.id));
    for (const row of fresh) {
      seen.add(row.id);
      byParent.set(row.parent_id, [...(byParent.get(row.parent_id) ?? []), row]);
    }
    frontier = fresh.map((row) => row.id);
  }
  return byParent;
};

const inTreeOrder = (byParent, parentId, depth) => (byParent.get(parentId) ?? [])
  .flatMap((row) => [{ row, depth }, ...inTreeOrder(byParent, row.id, depth + 1)]);

// Run usage imported by `team tokens --run --import` (task_usage), summed per mapped task.
const usageByTask = (db, taskIds) => {
  const hasTable = Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'task_usage'").get());
  const isUnused = !hasTable || taskIds.length === 0;
  if (isUnused) return new Map();
  const marks = taskIds.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT task_id, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
    SUM(cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS cached, SUM(cost_usd) AS cost
    FROM task_usage WHERE task_id IN (${marks}) GROUP BY task_id`).all(...taskIds);
  return new Map(rows.map((row) => [row.task_id, row]));
};

const NO_FIGURES = { source: null, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, costUsd: 0 };

// The task's own telemetry wins; imported run usage fills in only when the task never recorded any, so nothing counts twice.
const figuresOf = (row, usage) => {
  const hasTaskTelemetry = row.telemetry_source !== null && row.telemetry_source !== undefined;
  const task = {
    source: 'task', promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, cachedTokens: row.cached_tokens,
    totalTokens: row.total_tokens || row.prompt_tokens + row.completion_tokens, costUsd: row.cost_usd
  };
  const imported = usage && {
    source: 'run usage', promptTokens: usage.input, completionTokens: usage.output, cachedTokens: usage.cached,
    totalTokens: usage.input + usage.output, costUsd: usage.cost
  };
  return (hasTaskTelemetry && task) || imported || NO_FIGURES;
};

const toChild = ({ row, depth }, usage) => {
  const figures = figuresOf(row, usage.get(row.id));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assignee: row.assigned_agent_id,
    parentId: row.parent_id,
    depth,
    measured: figures.source !== null,
    ...figures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    wallMs: Math.max(0, row.updated_at - row.created_at)
  };
};

const sumOf = (children, key) => children.reduce((total, child) => total + child[key], 0);

const totalsOf = (children) => {
  const measured = children.filter((child) => child.measured).length;
  const hasChildren = children.length > 0;
  const first = hasChildren ? Math.min(...children.map((child) => child.createdAt)) : 0;
  const last = hasChildren ? Math.max(...children.map((child) => child.updatedAt)) : 0;
  return {
    children: children.length,
    measured,
    unmeasured: children.length - measured,
    promptTokens: sumOf(children, 'promptTokens'),
    completionTokens: sumOf(children, 'completionTokens'),
    cachedTokens: sumOf(children, 'cachedTokens'),
    totalTokens: sumOf(children, 'totalTokens'),
    costUsd: sumOf(children, 'costUsd'),
    spanMs: last - first
  };
};

/**
 * @param {object} db the team db
 * @param {number|string} epicId the epic's task id
 * @returns {{ epic: object, children: object[], totals: object } | { error: string }}
 */
export const rollupEpicTokens = (db, epicId) => {
  const id = parseTaskNumber(epicId);
  const isBadId = id === null;
  if (isBadId) return { error: `"${epicId}" is not a task id` };
  const epic = db.prepare('SELECT id, title, status FROM agent_tasks WHERE id = ?').get(id);
  const isMissing = !epic;
  if (isMissing) return { error: `Task #${id} not found on this board` };
  const walked = inTreeOrder(collectByParent(db, id), id, 1);
  const usage = usageByTask(db, walked.map(({ row }) => row.id));
  const children = walked.map((entry) => toChild(entry, usage));
  return { epic, children, totals: totalsOf(children) };
};

const fmtSpan = (ms) => {
  const seconds = Math.round((ms || 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad2 = (n) => String(n).padStart(2, '0');
  const isHours = seconds >= 3600;
  const isMinutes = seconds >= 60;
  const forms = { hours: `${hours}h${pad2(minutes)}m`, minutes: `${minutes}m${pad2(seconds % 60)}s`, seconds: `${seconds}s` };
  return forms[(isHours && 'hours') || (isMinutes && 'minutes') || 'seconds'];
};

const cut = (text, width) => (String(text).length > width ? `${String(text).slice(0, width - 1)}~` : String(text));
const left = (text, width) => String(text).padEnd(width);
const right = (text, width) => String(text).padStart(width);

const HEAD = `${left('', 54)}${left('status', 12)}${left('who', 15)}${right('prompt', 10)}${right('compl', 9)}${right('cached', 11)}${right('cost', 8)}${right('wall', 8)}`;

const childLine = (child) => {
  const name = left(`${'  '.repeat(child.depth)}#${child.id} ${cut(child.title, 44)}`, 54);
  const who = left(cut(child.assignee ?? '-', 14), 15);
  const figures = child.measured
    ? [fmtInt(child.promptTokens), fmtInt(child.completionTokens), fmtInt(child.cachedTokens), fmtUsd(child.costUsd)]
    : ['-', '-', '-', '-'];
  const [prompt, completion, cached, cost] = figures;
  return `${name}${left(child.status, 12)}${who}${right(prompt, 10)}${right(completion, 9)}${right(cached, 11)}${right(cost, 8)}${right(fmtSpan(child.wallMs), 8)}`;
};

const totalLine = (t) => {
  const kinds = `${fmtInt(t.promptTokens)} prompt, ${fmtInt(t.completionTokens)} completion, ${fmtInt(t.cachedTokens)} cached`;
  const known = `${t.measured} measured${t.unmeasured > 0 ? `, ${t.unmeasured} unknown (not zero)` : ''}`;
  return `Total: ${t.children} children (${known}), ${fmtInt(t.totalTokens)} tokens (${kinds}), ${fmtUsd(t.costUsd)}, ${fmtSpan(t.spanMs)} first created to last update`;
};

/** The text card: header, one line per child, one total. */
export const renderEpicTokens = (rollup) => {
  const { epic, children, totals } = rollup;
  const header = `Epic #${epic.id} ${cut(epic.title, 70)} [${epic.status}]`;
  const isChildless = children.length === 0;
  if (isChildless) return `${header}\nEpic #${epic.id} has no children on this board.\n`;
  return [header, HEAD, ...children.map(childLine), totalLine(totals), 'wall = created to last update per child; the board keeps no claim time, so queue time counts.'].join('\n') + '\n';
};

/** Print or return the rollup; an error sets exit code 1 on the CLI. */
export const handleEpicTokens = (db, opts, isJson, isCli) => {
  const isRefused = Boolean(opts.error);
  const result = isRefused ? { error: opts.error } : rollupEpicTokens(db, opts.epic);
  const isFailed = Boolean(result.error);
  if (!isCli) return result;
  if (isFailed) {
    process.stderr.write(`x ${result.error}\n`);
    process.exitCode = 1;
    return result;
  }
  process.stdout.write(isJson ? `${JSON.stringify(result, null, 2)}\n` : renderEpicTokens(result));
  return result;
};
