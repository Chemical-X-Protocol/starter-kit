import { ruleTree } from './rules.js';

/**
 * Literal search-and-replace for `chemx patch`.
 *
 * Splices by index, so `$&`, `$$`, `$'` and `` $` `` in the replacement are inserted verbatim
 * (String.prototype.replace would expand them). Empty targets are refused, ambiguity errors
 * name every matching line, and an LF target on a CRLF file is normalized to CRLF.
 */

const findAll = (content, target) => {
  const indexes = [];
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(target, from);
    const isMissing = idx === -1;
    if (isMissing) break;
    indexes.push(idx);
    from = idx + target.length;
  }
  return indexes;
};

export const lineOfIndex = (content, index) => content.slice(0, index).split('\n').length;

const usesCrlf = (text) => text.includes('\r\n');
const hasBareLf = (text) => /(^|[^\r])\n/.test(text);
const toCrlf = (text) => text.replace(/\r?\n/g, '\r\n');

const notFoundError = (filePath, isCrlfFile) => {
  const eolHint = isCrlfFile
    ? ' The file uses CRLF line endings; the target was tried with both LF and CRLF.'
    : '';
  return new Error(`Target content not found in ${filePath}.${eolHint} Verify indentation and exact characters (read the lines first; chemx read prints N| line numbers).`);
};

const validateTarget = (target, filePath) => {
  const isNonString = typeof target !== 'string';
  const gate = ruleTree({
    target: {
      invalidType: isNonString,
      empty: () => target.trim() === ''
    }
  }, { failFast: true });

  const isInvalid = !gate.ok;
  if (isInvalid) {
    throw new Error(`Refusing to patch ${filePath}: the target is empty or whitespace-only. Pass the exact text to replace.`);
  }
};

const validateMatches = (indexes, content, filePath, isCrlfFile, allowMultiple) => {
  const hasNoMatches = indexes.length === 0;
  const isMultiple = indexes.length > 1;
  const gate = ruleTree({
    search: {
      notFound: hasNoMatches,
      ambiguous: () => isMultiple && !allowMultiple
    }
  }, { failFast: true });

  const hasSearchError = !gate.ok;
  if (hasSearchError) {
    const isAmbiguous = gate.first === 'search.ambiguous';
    if (isAmbiguous) {
      const lines = indexes.map((idx) => lineOfIndex(content, idx));
      throw new Error(`Target content found multiple times in ${filePath}: ${indexes.length} matches at lines ${lines.join(', ')}. Extend the target to make it unique, or pass --multiple / allowMultiple to replace all.`);
    }
    throw notFoundError(filePath, isCrlfFile);
  }
};

/**
 * @param {string} content File content.
 * @param {string} target Exact text to find.
 * @param {string} replacement Text to insert (literal).
 * @param {object} [options] { allowMultiple, filePath }
 * @returns {{ content: string, count: number, lines: number[], eol: 'as-is'|'crlf-normalized' }}
 */
export const replaceLiteral = (content, target, replacement, options = {}) => {
  const filePath = options.filePath || 'file';
  validateTarget(target, filePath);

  const isCrlfFile = usesCrlf(content);
  const shouldNormalizeEol = isCrlfFile && hasBareLf(target) && !content.includes(target);
  const effectiveTarget = shouldNormalizeEol ? toCrlf(target) : target;
  const effectiveReplacement = shouldNormalizeEol ? toCrlf(replacement) : replacement;

  const indexes = findAll(content, effectiveTarget);
  validateMatches(indexes, content, filePath, isCrlfFile, options.allowMultiple);

  const lines = indexes.map((idx) => lineOfIndex(content, idx));

  let result = '';
  let cursor = 0;
  for (const idx of indexes) {
    result += content.slice(cursor, idx) + effectiveReplacement;
    cursor = idx + effectiveTarget.length;
  }
  const firstStart = indexes[0];
  const lastEnd = result.length;
  result += content.slice(cursor);

  const startLine = lineOfIndex(result, firstStart);
  const changedLines = { start: startLine, end: Math.max(startLine, lineOfIndex(result, Math.max(firstStart, lastEnd - 1))) };
  return { content: result, count: indexes.length, lines, changedLines, eol: shouldNormalizeEol ? 'crlf-normalized' : 'as-is' };
};
