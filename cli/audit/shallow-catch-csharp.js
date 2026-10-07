/**
 * Best-effort annotation window for C# shallow catches: which raw lines may carry the
 * `chemx-allow: best-effort <reason>` annotation that exempts one empty catch.
 */
import { parseBestEffortAllowance } from './rules-predicates.js';

// A best-effort annotation counts on the catch line, inside the body, on the closing-brace
// line, or on the line above when that line starts with a comment or is the commented closing
// brace of this catch's own try block (Stroustrup style). Other code on the line above, such
// as an annotated inner catch, belongs to another statement and never exempts this one.
// Raw lines are read (masked content erases comments), so annotation text quoted in a string
// on the catch's own lines also counts: a known gap the JS detector avoids by reading parser
// comments. Severity stays at the registry MEDIUM with no escalation, because C# definite
// assignment (CS0165) already rejects reading an unset local.
const COMMENT_LED_LINE = /^\s*\/[/*]/;
const COMMENTED_CLOSING_BRACE = /^\s*\}\s*\/[/*]/;

const findOpeningBrace = (maskedContent, closeIndex) => {
  let depth = 0;
  for (let i = closeIndex - 1; i >= 0; i -= 1) {
    const ch = maskedContent[i];
    const isMatchingOpen = ch === '{' && depth === 0;
    if (isMatchingOpen) return i;
    if (ch === '}') depth += 1;
    if (ch === '{') depth -= 1;
  }
  return -1;
};

// Comments and strings are blanked in the masked content, so braces quoted there never shift
// the match. The brace qualifies only when the block it closes was opened by a try keyword.
const closesOwnTryBlock = (lineAbove, lineAboveStart, maskedContent) => {
  if (!COMMENTED_CLOSING_BRACE.test(lineAbove)) return false;
  const openIndex = findOpeningBrace(maskedContent, lineAboveStart + lineAbove.indexOf('}'));
  if (openIndex < 0) return false;
  return /\btry$/.test(maskedContent.slice(0, openIndex).trimEnd().slice(-4));
};

const isLineAboveInWindow = (lineAbove, lineAboveStart, maskedContent) => {
  if (COMMENT_LED_LINE.test(lineAbove)) return true;
  return closesOwnTryBlock(lineAbove, lineAboveStart, maskedContent);
};

export const resolveCSharpCatchAllowance = (match, { content, lines, maskedContent }, lineNum) => {
  const endLineNum = lineNum + (match[0].match(/\n/g) || []).length;
  const lineAbove = lines[lineNum - 2] || '';
  const catchLineStart = content.lastIndexOf('\n', match.index - 1) + 1;
  const lineAboveStart = content.lastIndexOf('\n', catchLineStart - 2) + 1;
  const ownLines = lines.slice(lineNum - 1, endLineNum);
  const isAboveCounted = isLineAboveInWindow(lineAbove, lineAboveStart, maskedContent);
  const texts = isAboveCounted ? [lineAbove, ...ownLines] : ownLines;
  const allowances = texts.map((text) => parseBestEffortAllowance(text));
  return {
    isExempt: allowances.some((allowance) => allowance.hasReason),
    isAnnotated: allowances.some((allowance) => allowance.isAnnotated)
  };
};
