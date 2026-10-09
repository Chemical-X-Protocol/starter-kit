/**
 * Token-aware mechanical fixes for one file's content.
 *
 * Only comments are edited, located by a real tokenizer (see comment-ranges.js): string
 * literals, template literals, JSX text and Vue/Svelte templates are never touched. A comment
 * flagged as AI residue is removed whole (never just its first line). Leaked Markdown fences
 * are removed only as the first/last non-blank line of a JS/TS file, and only when the result
 * parses (a fence pair can parse as tagged templates, so the original is not required to fail). setTimeout(fn, 0) is reported as a suggestion, never rewritten.
 */
import { findSourceRanges } from '../comment-ranges.js';
import { parseSource, langForPath } from '../source-parse.js';
import { lineOfIndex } from '../literal-replace.js';

const RESIDUE_PATTERNS = [
  ['hope this', 'helps'].join(' '),
  ['feel free', 'to tweak'].join(' '),
  ['let me know', 'if you need'].join(' '),
  ['as an ai', 'language model'].join(' ')
];
const RESIDUE_REGEX = new RegExp(`\\b(?:${RESIDUE_PATTERNS.join('|')})\\b`, 'i');
const PREAMBLE_REGEX = /\b(?:here(?:'s| is) the (?:complete|updated|refactored|full) (?:code|implementation|file|component|version))\b/i;
const TRUNCATION_REGEX = /^(?:\/\/|\/\*)\s*\.\.\.\s*(?:existing|rest of|remaining)\s+(?:code|implementation|logic|imports)/i;
const FENCE_LINE_REGEX = /^\s*```(?:typescript|javascript|tsx|jsx|vue|js|ts|html|css|scss)?\s*$/;
const TIMER_REGEX = /setTimeout\([^,]+,\s*0\)/g;
const EM_DASH = '—';

const insideAny = (ranges, index) => ranges.some((r) => index >= r.start && index < r.end);

const stripEdgeFences = (content, filePath, fixes) => {
  const isScript = Boolean(langForPath(filePath));
  if (!isScript) return content;
  const lines = content.split('\n');
  const nonBlank = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const edges = [nonBlank[0], nonBlank[nonBlank.length - 1]].filter((i) => i !== undefined && FENCE_LINE_REGEX.test(lines[i]));
  const fenceLines = [...new Set(edges)];
  const candidate = lines.filter((_, i) => !fenceLines.includes(i)).join('\n');
  const isRepaired = fenceLines.length > 0 && parseSource(candidate, filePath).ok;
  if (!isRepaired) return content;
  fenceLines.forEach((i) => fixes.push({ line: i + 1, rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT', action: 'Removed leaked markdown code fence' }));
  return candidate;
};

const wholeCommentSpan = (content, comment) => {
  const lineStart = content.lastIndexOf('\n', comment.start - 1) + 1;
  const nextNewline = content.indexOf('\n', comment.end);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline;
  const isAloneOnLines = content.slice(lineStart, comment.start).trim() === '' && content.slice(comment.end, lineEnd).trim() === '';
  const isLastLine = nextNewline === -1;
  const lineSpanStart = isLastLine && lineStart > 0 ? lineStart - 1 : lineStart;
  if (isAloneOnLines) return { start: lineSpanStart, end: isLastLine ? lineEnd : lineEnd + 1 };
  let start = comment.start;
  while (start > lineStart && /[ \t]/.test(content[start - 1])) start--;
  return { start, end: comment.end };
};

const classifyComment = (text, shouldFix) => {
  const isResidue = PREAMBLE_REGEX.test(text) || RESIDUE_REGEX.test(text);
  if (isResidue && shouldFix('AI_SLOP_CONVERSATIONAL_ARTIFACT')) return { rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT', action: 'Removed AI conversational residue comment' };
  const isPlaceholder = TRUNCATION_REGEX.test(text.trim());
  if (isPlaceholder && shouldFix('AI_SLOP_LAZY_PLACEHOLDER')) return { rule: 'AI_SLOP_LAZY_PLACEHOLDER', action: 'Removed lazy AI truncation placeholder comment' };
  return null;
};

const commentEdits = (content, ranges, shouldFix, fixes) => {
  const edits = [];
  for (const comment of [...ranges.comments].sort((a, b) => a.start - b.start)) {
    const text = content.slice(comment.start, comment.end);
    const removal = classifyComment(text, shouldFix);
    if (removal) {
      edits.push({ ...wholeCommentSpan(content, comment), text: '' });
      fixes.push({ line: lineOfIndex(content, comment.start), ...removal });
      continue;
    }
    const hasEmDash = text.includes(EM_DASH) && shouldFix('TYPOGRAPHY_EM_DASH');
    if (!hasEmDash) continue;
    edits.push({ start: comment.start, end: comment.end, text: text.split(EM_DASH).join('-') });
    const dashLines = new Set([...text.matchAll(new RegExp(EM_DASH, 'g'))].map((m) => lineOfIndex(content, comment.start + m.index)));
    dashLines.forEach((line) => fixes.push({ line, rule: 'TYPOGRAPHY_EM_DASH', action: 'Replaced em dash with standard hyphen in a comment' }));
  }
  return edits;
};

const timerSuggestions = (content, ranges, shouldFix) => {
  if (!shouldFix('MACRO_TASK_OVER_MICRO_TASK')) return [];
  const skip = [...ranges.comments, ...ranges.literals];
  return [...content.matchAll(TIMER_REGEX)]
    .filter((m) => insideAny(ranges.codeRegions, m.index) && !insideAny(skip, m.index))
    .map((m) => ({
      line: lineOfIndex(content, m.index),
      rule: 'MACRO_TASK_OVER_MICRO_TASK',
      suggestion: 'Consider queueMicrotask(fn) if the timer id is never cleared (not applied: queueMicrotask returns undefined, so clearTimeout(id) would stop working).'
    }));
};

/**
 * @param {string} content File content.
 * @param {object} [options] { filePath = 'file.ts', rules }
 * @returns {{ fixedContent: string, fixes: object[], suggestions: object[], skipped: string|null }}
 */
export const autofixContent = (content, options = {}) => {
  const filePath = options.filePath || 'file.ts';
  const allowedRules = options.rules ? new Set(options.rules) : null;
  const shouldFix = (rule) => !allowedRules || allowedRules.has(rule);
  const fixes = [];

  const fenceShouldRun = shouldFix('AI_SLOP_CONVERSATIONAL_ARTIFACT');
  const base = fenceShouldRun ? stripEdgeFences(content, filePath, fixes) : content;
  const ranges = findSourceRanges(base, filePath);
  if (!ranges) return { fixedContent: base, fixes, suggestions: [], skipped: 'no tokenizer for this file type, or it does not parse' };

  const edits = commentEdits(base, ranges, shouldFix, fixes);
  let fixedContent = base;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    fixedContent = fixedContent.slice(0, edit.start) + edit.text + fixedContent.slice(edit.end);
  }
  return { fixedContent, fixes, suggestions: timerSuggestions(base, ranges, shouldFix), skipped: null };
};
