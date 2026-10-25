/**
 * Chemical X Protocol: the long brief of a task, kept apart from its description (K14, #6759).
 * A description is the short ask every list and card carries; a brief is a design contract of many KB that a
 * builder reads once. `task show` prints only its length, `task show --full` and `team brief <id>` print it.
 * (cli/team/team-brief.js is the SessionStart card, a different thing.)
 * Guaranteed: a stored brief is trimmed at the end, non-empty and at most MAX_BRIEF_CHARS characters; a
 * refused brief writes nothing. Not guaranteed: briefs are not versioned (a new one replaces the old; the
 * feed keeps the line "Brief set on #n: N chars") and are not searched by `task list --search`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { postFeedEvent } from './team-db-feed.js';

export const MAX_BRIEF_CHARS = 200000;

/** @returns {{ text: string } | { error: string }} the text to store (end-trimmed), or why it cannot be stored */
export const checkBriefText = (raw) => {
  const text = String(raw ?? '').replace(/\s+$/, '');
  const isEmpty = text.trim() === '';
  if (isEmpty) return { error: 'the brief is empty (to remove a brief use --clear)' };
  const isTooLong = text.length > MAX_BRIEF_CHARS;
  if (isTooLong) return { error: `the brief is ${text.length.toLocaleString('en-US')} characters; the limit is ${MAX_BRIEF_CHARS.toLocaleString('en-US')}` };
  return { text };
};

export const briefChars = (task) => String(task?.brief ?? '').trim().length;

/** 7214 -> "7,214", the same in every locale. */
export const groupedChars = (count) => Number(count).toLocaleString('en-US');

/** The task with `briefChars` always and the brief text only when full is true (a card or JSON list must not carry 7 KB by accident). */
export const summarizeBrief = (task, { full = false } = {}) => {
  const { brief, ...rest } = task;
  return full ? { ...task, briefChars: briefChars(task) } : { ...rest, briefChars: briefChars(task) };
};

const readAllStdin = () => fs.readFileSync(0, 'utf8');

/**
 * The text from --file (relative to cwd) or --stdin.
 * @returns {{ text: string } | { error: string }}
 */
export const readBriefSource = ({ file, stdin }, { cwd, readStdin = readAllStdin } = {}) => {
  const hasFile = typeof file === 'string' && file !== '';
  const wantsStdin = Boolean(stdin);
  const hasBothOrNeither = hasFile === wantsStdin;
  if (hasBothOrNeither) return { error: 'give exactly one of --file <path> or --stdin' };
  if (wantsStdin) return checkBriefText(readStdin());
  const fullPath = path.resolve(cwd ?? process.cwd(), file);
  try {
    return checkBriefText(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    return { error: `cannot read ${file}: ${err.message}` };
  }
};

/** Replaces the brief ('' clears it) and notes it in the feed; returns the characters stored. */
export const storeBrief = (db, taskId, text, authorId) => {
  db.prepare('UPDATE agent_tasks SET brief = ?, updated_at = ? WHERE id = ?').run(text, Date.now(), Number(taskId));
  const chars = text.length;
  const message = chars === 0 ? `Brief cleared on #${taskId}` : `Brief set on #${taskId}: ${chars} chars`;
  postFeedEvent(db, { author_id: authorId, task_id: Number(taskId), event_type: 'status_update', message });
  return chars;
};

/**
 * One brief request for a task: clear it, set it from text / --file / --stdin, or (with no source) read it.
 * @param {{ clear?: boolean, text?: string, file?: string, stdin?: boolean, authorId: string }} request
 * @returns {{ error: string } | { taskId: number, action: 'set'|'cleared'|'read', chars: number, brief?: string }}
 */
export const runBriefRequest = (db, task, request, io = {}) => {
  const hasText = request.text !== undefined;
  const hasFileOrStdin = Boolean(request.file) || Boolean(request.stdin);
  const sourceCount = [hasText, hasFileOrStdin, Boolean(request.clear)].filter(Boolean).length;
  const isConflict = sourceCount > 1;
  if (isConflict) return { error: 'give one of --file <path>, --stdin or --clear, not several' };
  if (request.clear) return { taskId: task.id, action: 'cleared', chars: storeBrief(db, task.id, '', request.authorId) };
  const isRead = sourceCount === 0;
  if (isRead) return { taskId: task.id, action: 'read', chars: briefChars(task), brief: String(task.brief ?? '') };
  const source = hasText ? checkBriefText(request.text) : readBriefSource(request, io);
  if (source.error) return { error: source.error };
  return { taskId: task.id, action: 'set', chars: storeBrief(db, task.id, source.text, request.authorId) };
};

/** The one-line ack of a set or clear: `#12: brief set (7,214 chars)`. */
export const describeBriefResult = (result) => {
  const isCleared = result.action === 'cleared';
  return isCleared ? `#${result.taskId}: brief cleared` : `#${result.taskId}: brief set (${result.chars.toLocaleString('en-US')} chars)`;
};
