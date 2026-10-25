/**
 * Chemical X Protocol: `chemx team task add --from <file.json|yaml>` (K14, #6759).
 * Files a whole epic with its children in one call: every row is checked first (task-file-rows.js), then all
 * rows are written in one transaction and each gets its `task_created` feed event. Rows may point at each
 * other with ref / parent_ref / deps, so ids are assigned in file order and the links are written second.
 * Guaranteed: a problem anywhere in the file, or a refusal by the database, leaves the board unchanged
 * (--dry-run stops after the checks). Not guaranteed: two agents adding at once may interleave ids, and a
 * parent or dependency id that vanishes between the checks and the write is not re-checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createTask, getTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { postFeedEvent } from './team-db-feed.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { resolveTaskRef } from './task-ref.js';
import { describeTaskAdded, taskAckFields } from './task-brief-view.js';
import { parseTaskFile, normalizeRows, checkRowLinks } from './task-file-rows.js';

const readAllStdin = () => fs.readFileSync(0, 'utf8');

/** @returns {{ text: string, name: string, baseDir: string } | { error: string }} */
const readSource = (file, { cwd, readStdin }) => {
  const isStdin = file === '-';
  if (isStdin) return { text: readStdin(), name: 'stdin', baseDir: cwd };
  const fullPath = path.resolve(cwd, file);
  try {
    return { text: fs.readFileSync(fullPath, 'utf8'), name: file, baseDir: path.dirname(fullPath) };
  } catch (err) {
    return { error: `cannot read ${file}: ${err.message}` };
  }
};

// Ids in a file name tasks of this board; an id a merge renumbered resolves through task_aliases like any other id argument.
const resolveBoardIds = (ctx, rows) => {
  const resolve = (id) => resolveTaskRef(ctx.db, id, { repo: ctx.repo }).id ?? id;
  return rows.map((row) => ({
    ...row,
    parentId: row.parentId === null ? null : resolve(row.parentId),
    depIds: row.depIds.map(resolve)
  }));
};

const detailsOf = (row) => [
  row.ref ? `ref ${row.ref}` : null,
  row.kind === 'task' ? null : row.kind,
  row.needs ? `needs ${row.needs}` : null,
  row.priority ? `P${row.priority}` : null,
  row.parentRef ? `parent ${row.parentRef}` : null,
  row.parentId === null ? null : `parent #${row.parentId}`,
  row.depRefs.length + row.depIds.length > 0 ? `deps ${[...row.depRefs, ...row.depIds.map((id) => `#${id}`)].join(', ')}` : null
].filter(Boolean);

const planOf = (row) => ({
  ref: row.ref, title: row.title, kind: row.kind, needs: row.needs, priority: row.priority ?? null,
  parent: row.parentRef ?? row.parentId, deps: [...row.depRefs, ...row.depIds]
});

const writeRows = (ctx, rows, authorHandle) => withImmediateTransaction(ctx.db, () => {
  const created = rows.map((row) => createTask(ctx.db, {
    title: row.title, description: row.description, priority: row.priority || 2, needs: row.needs,
    kind: row.kind, brief: row.brief, repo: ctx.repo
  }));
  const idOfRef = new Map(rows.flatMap((row, index) => (row.ref === null ? [] : [[row.ref, created[index].id]])));
  rows.forEach((row, index) => {
    const parentId = row.parentRef === null ? row.parentId : idOfRef.get(row.parentRef);
    const dependencies = [...row.depRefs.map((ref) => idOfRef.get(ref)), ...row.depIds];
    ctx.db.prepare('UPDATE agent_tasks SET parent_id = ?, dependencies = ? WHERE id = ?').run(parentId, JSON.stringify(dependencies), created[index].id);
    postFeedEvent(ctx.db, { author_id: authorHandle, task_id: created[index].id, event_type: 'task_created', message: `Created task #${created[index].id}: ${row.title}` });
  });
  return { created: created.map((task) => getTask(ctx.db, task.id)), refs: Object.fromEntries(idOfRef) };
});

/**
 * @param {{ db: object, repo: string }} ctx the team context
 * @param {{ file: string, cwd: string, authorHandle: string, dryRun?: boolean, readStdin?: () => string }} options file '-' reads stdin
 * @returns {{ error: string } | { problems: string[] } | { dryRun: true, plan: object[] } | { added: object[], refs: object, tasks: object[] }}
 */
export const addTasksFromFile = (ctx, { file, cwd, authorHandle, dryRun = false, readStdin = readAllStdin }) => {
  const source = readSource(file, { cwd, readStdin });
  if (source.error) return { error: source.error };
  const parsed = parseTaskFile(source.text, file === '-' ? 'stdin' : file);
  if (parsed.error) return { error: parsed.error };
  const normalized = normalizeRows(parsed.rows, { baseDir: source.baseDir, readFile: (full) => fs.readFileSync(full, 'utf8') });
  const rows = resolveBoardIds(ctx, normalized.rows);
  const problems = [...normalized.problems, ...checkRowLinks(rows, { findTask: (id) => getTask(ctx.db, id) })];
  const hasProblems = problems.length > 0;
  if (hasProblems) return { problems, file: source.name };
  if (dryRun) return { dryRun: true, plan: rows.map(planOf), lines: rows.map((row) => `would add: ${row.title}${detailsOf(row).length ? ` (${detailsOf(row).join(', ')})` : ''}`) };
  registerAgent(ctx.db, { id: authorHandle, role: 'contributor' });
  try {
    const { created, refs } = writeRows(ctx, rows, authorHandle);
    return { added: created.map(taskAckFields), refs, tasks: created };
  } catch (err) {
    return { error: `Nothing was written: ${err.message}` };
  }
};

/** The lines a successful add prints: one `#<id> added: <title>` per row, then `refs: a=#1 b=#2`. */
export const describeAdded = (result) => {
  const lines = result.tasks.map(describeTaskAdded);
  const refs = Object.entries(result.refs).map(([ref, id]) => `${ref}=#${id}`);
  return refs.length > 0 ? [...lines, `refs: ${refs.join(' ')}`] : lines;
};

/** The lines a dry run prints. */
export const describeDryRun = (result) => [`dry run: ${result.plan.length} task(s) would be added, nothing was written`, ...result.lines];

/** The lines a refused file prints: the count, the promise, then one line per problem. */
export const describeProblems = (result) => [`${result.file}: ${result.problems.length} problem(s). Nothing was written.`, ...result.problems.map((problem) => `  ${problem}`)];

// The flags `task add` reads for one task; beside --from they would be silently ignored, so they are refused.
const FIELD_FLAGS = {
  title: '--title', needs: '--needs', priority: '--prio', kind: '--kind', parent: '--parent', description: '--desc',
  dependencies: '--deps', target: '--target', sprint: '--sprint', moscow: '--moscow', rule: '--rule', tier: '--tier', agent: '--agent'
};

const strayFields = (flags, words) => [
  ...(words.length > 0 ? ['a title'] : []),
  ...Object.entries(FIELD_FLAGS).filter(([key]) => flags[key] !== undefined).map(([, flag]) => flag)
];

const refuseFile = (isCli, message, extra = {}) => {
  if (isCli) {
    process.exitCode = 1;
    process.stderr.write(`\x1b[31m✕ ${message}\x1b[0m\n`);
  }
  return { error: message, refused: true, ...extra };
};

const writeLines = (isCli, flags, value, lines) => {
  if (!isCli) return;
  process.stdout.write(flags.isJson ? `${JSON.stringify(value)}\n` : `${lines.join('\n')}\n`);
};

/** `task add --from <file>` for the CLI and the programmatic API: checks, prints, and returns the result object. */
export const runAddFromFile = (ctx, { positionals, flags, titleWords, isCli, cwd }) => {
  const words = [...positionals.slice(1), ...titleWords];
  const stray = strayFields(flags, words);
  const hasStray = stray.length > 0;
  if (hasStray) return refuseFile(isCli, `task add --from takes every field from the file; drop ${stray.join(', ')}`);
  const hasNoFile = typeof flags.from !== 'string' || flags.from === '';
  if (hasNoFile) return refuseFile(isCli, 'task add --from needs a file: --from <file.json|yaml> (or --from=- for stdin)');
  const result = addTasksFromFile(ctx, { file: flags.from, cwd, authorHandle: flags.as || '@agent', dryRun: Boolean(flags.dryRun) });
  if (result.error) return refuseFile(isCli, result.error);
  if (result.problems) {
    if (isCli) process.exitCode = 1;
    if (isCli) process.stderr.write(`\x1b[31m${describeProblems(result).join('\n')}\x1b[0m\n`);
    return { error: 'invalid task file', refused: true, problems: result.problems };
  }
  if (result.dryRun) {
    writeLines(isCli, flags, { dryRun: true, plan: result.plan }, describeDryRun(result));
    return result;
  }
  writeLines(isCli, flags, { dryRun: false, added: result.added, refs: result.refs }, describeAdded(result));
  return result;
};
