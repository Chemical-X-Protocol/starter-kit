/**
 * Chemical X Protocol: the rows of a task file (`task add --from file.json|yaml`, K14, #6759).
 * parseTaskFile reads the file, normalizeRows checks every field of every row, and checkRowLinks checks the
 * parents and dependencies (refs inside the file, ids on the board, no loops). All three report every problem
 * they find, so one run fixes a whole file. Nothing here writes to the board.
 * A row: ref (a name other rows use), title, needs, prio, kind, parent (a task id) or parent_ref (a ref),
 * deps (ids and refs), desc, brief or brief_file (a path relative to the task file).
 * Guaranteed: an unknown key is a problem (a typo is never dropped silently). Not guaranteed: ids and refs
 * are checked against the board as it is when the file is read, not when it is written.
 */
import path from 'node:path';
import { parseYamlLite } from './task-yaml-lite.js';
import { checkNeedsInput } from './team-needs.js';
import { checkKindInput } from './task-kind.js';
import { checkBriefText } from './task-brief-store.js';
import { clipText } from './team-feed-view.js';

export const MAX_ROWS = 500;
const ALLOWED_KEYS = ['ref', 'title', 'needs', 'prio', 'priority', 'kind', 'parent', 'parent_ref', 'deps', 'desc', 'description', 'brief', 'brief_file'];
const REF_PATTERN = /^[A-Za-z][\w.-]*$/;
const ID_PATTERN = /^#?(\d+)$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnset = (value) => value === undefined || value === null || value === '';

const parseJsonText = (text, name) => {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: `${name} is not valid JSON: ${err.message}` };
  }
};

const parseYamlText = (text, name) => {
  const parsed = parseYamlLite(text);
  return parsed.error ? { error: `${name}: ${parsed.error}` } : parsed;
};

/** @returns {{ rows: object[] } | { error: string }} the raw rows of a .json or .yaml/.yml file (other names are sniffed) */
export const parseTaskFile = (text, filePath) => {
  const name = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const isYamlName = extension === '.yaml' || extension === '.yml';
  const isJsonName = extension === '.json';
  const looksJson = !isYamlName && /^\s*[[{]/.test(text);
  const parsed = isJsonName || looksJson ? parseJsonText(text, name) : parseYamlText(text, name);
  if (parsed.error) return parsed;
  const list = Array.isArray(parsed.value) ? parsed.value : parsed.value?.tasks;
  const isList = Array.isArray(list);
  if (!isList) return { error: `${name}: expected a list of task rows (or a mapping with a "tasks" list)` };
  const isEmptyList = list.length === 0;
  if (isEmptyList) return { error: `${name} has no task rows` };
  const isTooLong = list.length > MAX_ROWS;
  if (isTooLong) return { error: `${name} has ${list.length} rows; add at most ${MAX_ROWS} per file` };
  const oddRow = list.findIndex((row) => !isPlainObject(row));
  const hasOddRow = oddRow !== -1;
  if (hasOddRow) return { error: `${name}: row ${oddRow + 1} is not a mapping (key: value lines)` };
  return { rows: list };
};

const labelOf = (index, title) => {
  const hasTitle = typeof title === 'string' && title.trim() !== '';
  return hasTitle ? `row ${index + 1} (${clipText(title.trim(), 40)})` : `row ${index + 1}`;
};

const parseId = (value) => {
  const isId = Number.isInteger(value) && value > 0;
  if (isId) return value;
  const match = typeof value === 'string' ? ID_PATTERN.exec(value.trim()) : null;
  return match ? Number(match[1]) : null;
};

const listOf = (raw) => {
  if (isUnset(raw)) return [];
  if (Array.isArray(raw)) return raw;
  return typeof raw === 'string' ? raw.split(',').map((word) => word.trim()).filter(Boolean) : [raw];
};

const readDeps = (raw, say) => {
  const depIds = [];
  const depRefs = [];
  for (const entry of listOf(raw)) {
    const id = parseId(entry);
    const isRef = typeof entry === 'string' && REF_PATTERN.test(entry.trim());
    const isId = id !== null;
    if (isId) depIds.push(id);
    else if (isRef) depRefs.push(entry.trim());
    else say(`deps entry "${entry}" is neither a task id nor a ref`);
  }
  return { depIds: [...new Set(depIds)], depRefs: [...new Set(depRefs)] };
};

const readPriority = (row, say) => {
  const hasBoth = !isUnset(row.prio) && !isUnset(row.priority);
  if (hasBoth) say('give prio or priority, not both');
  const given = isUnset(row.prio) ? row.priority : row.prio;
  if (isUnset(given)) return undefined;
  const value = Number(given);
  const isValid = Number.isInteger(value) && value >= 1 && value <= 5;
  if (!isValid) say('prio must be a whole number from 1 to 5');
  return isValid ? value : undefined;
};

const readText = (raw, name, say) => {
  if (isUnset(raw)) return '';
  const isText = typeof raw === 'string';
  if (!isText) say(`${name} must be text`);
  return isText ? raw.replace(/\s+$/, '') : '';
};

const readBrief = (row, options, say) => {
  const hasBoth = !isUnset(row.brief) && !isUnset(row.brief_file);
  if (hasBoth) say('give brief or brief_file, not both');
  if (!isUnset(row.brief_file)) return readBriefFile(row.brief_file, options, say);
  const text = readText(row.brief, 'brief', say);
  const checked = text === '' ? { text: '' } : checkBriefText(text);
  if (checked.error) say(checked.error);
  return checked.text ?? '';
};

const readBriefFile = (file, options, say) => {
  let text = '';
  try {
    text = options.readFile(path.resolve(options.baseDir, String(file)));
  } catch (err) {
    say(`brief_file "${file}" cannot be read: ${err.message}`);
    return '';
  }
  const checked = checkBriefText(text);
  if (checked.error) say(`brief_file "${file}": ${checked.error}`);
  return checked.text ?? '';
};

const readParent = (row, say) => {
  const hasBoth = !isUnset(row.parent) && !isUnset(row.parent_ref);
  if (hasBoth) say('give parent or parent_ref, not both');
  const parentId = isUnset(row.parent) ? null : parseId(row.parent);
  const isBadId = !isUnset(row.parent) && parentId === null;
  if (isBadId) say(`parent "${row.parent}" is not a task id (use parent_ref for a ref)`);
  const parentRef = isUnset(row.parent_ref) ? null : String(row.parent_ref).trim();
  const isBadRef = parentRef !== null && !REF_PATTERN.test(parentRef);
  if (isBadRef) say(`parent_ref "${parentRef}" is not a ref (a name that starts with a letter)`);
  return { parentId, parentRef: isBadRef ? null : parentRef };
};

const normalizeRow = (raw, index, options) => {
  const problems = [];
  const say = (message) => problems.push(`${labelOf(index, raw.title)}: ${message}`);
  for (const key of Object.keys(raw)) {
    const isKnown = ALLOWED_KEYS.includes(key);
    if (!isKnown) say(`unknown key "${key}" (allowed: ${ALLOWED_KEYS.join(', ')})`);
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const hasNoTitle = title === '';
  if (hasNoTitle) say('title is required (a non-empty text)');
  const ref = isUnset(raw.ref) ? null : String(raw.ref).trim();
  const isBadRef = ref !== null && !REF_PATTERN.test(ref);
  if (isBadRef) say(`ref "${ref}" must start with a letter and use only letters, digits, _, - and .`);
  const needs = checkNeedsInput(raw.needs);
  if (needs.error) say(needs.error);
  const kind = checkKindInput(raw.kind);
  if (kind.error) say(kind.error);
  const hasBothTexts = !isUnset(raw.desc) && !isUnset(raw.description);
  if (hasBothTexts) say('give desc or description, not both');
  const description = readText(isUnset(raw.desc) ? raw.description : raw.desc, 'desc', say);
  const row = {
    index, ref: isBadRef ? null : ref, title, kind: kind.kind ?? 'task', needs: needs.needs ?? null, priority: readPriority(raw, say),
    description, brief: readBrief(raw, options, say), ...readParent(raw, say), ...readDeps(raw.deps, say)
  };
  return { row, problems };
};

/**
 * @param {object[]} rawRows from parseTaskFile
 * @param {{ baseDir: string, readFile: (file: string) => string }} options baseDir: where brief_file paths start
 * @returns {{ rows: object[], problems: string[] }}
 */
export const normalizeRows = (rawRows, options) => {
  const results = rawRows.map((raw, index) => normalizeRow(raw, index, options));
  const rows = results.map((result) => result.row);
  const problems = results.flatMap((result) => result.problems);
  const firstOwner = new Map();
  for (const row of rows) {
    const hasRef = row.ref !== null;
    const isRepeat = hasRef && firstOwner.has(row.ref);
    const isFirstUse = hasRef && !isRepeat;
    if (isRepeat) problems.push(`${labelOf(row.index, row.title)}: ref "${row.ref}" is used by row ${firstOwner.get(row.ref) + 1} too`);
    if (isFirstUse) firstOwner.set(row.ref, row.index);
  }
  return { rows, problems };
};

// One DFS over the rows that name a ref; a self edge is reported on its own, so it is skipped here.
const findLoops = (rows, byRef, label, edgesOf) => {
  const state = new Map();
  const loops = [];
  const visit = (row, trail) => {
    state.set(row.ref, 'visiting');
    for (const next of edgesOf(row)) {
      const target = byRef.get(next);
      const isUnreachable = !target || target === row;
      if (isUnreachable) continue;
      const status = state.get(next);
      const closesLoop = status === 'visiting';
      const isUnvisited = status === undefined;
      if (closesLoop) loops.push(`${label} loop: ${[...trail.slice(trail.indexOf(next)), next].join(' -> ')}`);
      if (isUnvisited) visit(target, [...trail, next]);
    }
    state.set(row.ref, 'done');
  };
  for (const row of rows) {
    const isUnvisited = row.ref !== null && !state.has(row.ref);
    if (isUnvisited) visit(row, [row.ref]);
  }
  return loops;
};

const refProblems = (row, byRef) => {
  const label = labelOf(row.index, row.title);
  const problems = [];
  const hasParentRef = row.parentRef !== null;
  const hasUnknownParent = hasParentRef && !byRef.has(row.parentRef);
  const isOwnParent = hasParentRef && row.parentRef === row.ref;
  if (hasUnknownParent) problems.push(`${label}: parent_ref "${row.parentRef}" names no row in the file`);
  if (isOwnParent) problems.push(`${label}: parent_ref names the row itself`);
  for (const ref of row.depRefs) {
    const isUnknown = !byRef.has(ref);
    const isOwn = ref === row.ref;
    if (isUnknown) problems.push(`${label}: deps ref "${ref}" names no row in the file`);
    if (isOwn) problems.push(`${label}: deps lists its own ref "${ref}"`);
  }
  return problems;
};

const idProblems = (row, findTask) => {
  const label = labelOf(row.index, row.title);
  const problems = [];
  const hasMissingParent = row.parentId !== null && !findTask(row.parentId);
  if (hasMissingParent) problems.push(`${label}: parent #${row.parentId} is not a task on this board`);
  for (const id of row.depIds) {
    const isMissing = !findTask(id);
    if (isMissing) problems.push(`${label}: dep #${id} is not a task on this board`);
  }
  return problems;
};

/** @returns {string[]} the problems with the links between rows and the board, empty when the file can be added */
export const checkRowLinks = (rows, { findTask }) => {
  const byRef = new Map(rows.filter((row) => row.ref !== null).map((row) => [row.ref, row]));
  return [
    ...rows.flatMap((row) => [...refProblems(row, byRef), ...idProblems(row, findTask)]),
    ...findLoops(rows, byRef, 'parent_ref', (row) => (row.parentRef === null ? [] : [row.parentRef])),
    ...findLoops(rows, byRef, 'deps', (row) => row.depRefs)
  ];
};
