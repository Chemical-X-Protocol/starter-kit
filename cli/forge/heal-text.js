// Text helpers shared by the heal ops (engine doc, Heal: DETERMINISTIC PART). Every op works on the
// original text by offsets; nothing is reprinted, so bytes outside the edited spans never change.
import { parseBabel, langForPath } from '../source-parse.js';
import { contentHashOf } from './fingerprint-session.js';

export class HealError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'HealError';
    this.code = code;
    this.details = details;
  }
}

/** sha1 of a file's whole text (the blueprint's contentHash). */
export const fileHashOf = (text) => contentHashOf(text);

/**
 * Hash of a member body that ignores where it sits: each line trimmed, blank lines kept. Moving the
 * member (line drift) or re-indenting it keeps the hash; any token change inside it does not.
 */
export const bodyHashOf = (text) => contentHashOf(text.split('\n').map((line) => line.trim()).join('\n')).slice(0, 16);

/** The module AST of a script file (Babel, no error recovery). Throws on a parse error. */
export const parseModuleText = (text, file) => parseBabel(text, langForPath(file) ?? 'js');

/** Offset of the first character of the line holding offset. */
export const lineStartOf = (text, offset) => text.lastIndexOf('\n', offset - 1) + 1;

/** The whitespace before offset on its line, or '' when code precedes it there. */
export const indentAt = (text, offset) => {
  const prefix = text.slice(lineStartOf(text, offset), offset);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
};

/** Offset just past the newline that ends the line holding offset (or the text end). */
export const lineEndAfter = (text, offset) => {
  const newline = text.indexOf('\n', offset);
  return newline === -1 ? text.length : newline + 1;
};

/**
 * Applies non-overlapping { start, end, text } splices to text (any order given). Overlapping spans
 * throw HEAL_OVERLAP: two ops never edit the same bytes.
 */
export const spliceAll = (text, splices) => {
  const ordered = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  let floor = text.length + 1;
  for (const splice of ordered) {
    const isOverlapping = splice.end > floor;
    if (isOverlapping) throw new HealError('HEAL_OVERLAP', `two edits overlap at offset ${splice.start}`);
    result = result.slice(0, splice.start) + splice.text + result.slice(splice.end);
    floor = splice.start;
  }
  return result;
};

/** 1-based line of an offset. */
export const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
