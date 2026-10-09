// Own returns of a statement span (engine doc section 5, N2: a window that contains `return` must reach
// the end of the function body). A piece cut out of a body cannot carry a `return` of the enclosing
// function unless it ends that body, so N1 statement instances and N2 windows with an own return are
// dropped unless the span ends its function's body (body-ends.js) or its last statement is itself an
// unconditional `return` (then `return piece()` keeps every path). Ending a loop or `if` body is not
// enough: a conditional return there must let the loop go on. Only returns of the span's own function
// count: a `return` inside a nested arrow or function belongs to that function. The span text is parsed
// on its own (return and await allowed outside a function); a span that does not parse alone is judged
// by the word `return`.
import { parse } from '../babel-lazy.js';
import { SCRIPT_PARSE_OPTIONS } from '../sfc/script-asts.js';

const RETURN_WORD = /\breturn\b/;
const FUNCTION_TYPE = /Function|Method/;
const SKIPPED_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);
const PARSE_OPTIONS = Object.freeze({
  ...SCRIPT_PARSE_OPTIONS,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowSuperOutsideMethod: true,
  allowUndeclaredExports: true
});

const isNode = (value) => Boolean(value) && typeof value.type === 'string';

const childNodes = (node) => Object.keys(node)
  .filter((key) => !SKIPPED_KEYS.has(key))
  .flatMap((key) => [node[key]].flat())
  .filter(isNode);

const returnsOwn = (node) => {
  const isReturn = node.type === 'ReturnStatement';
  const isNestedFunction = FUNCTION_TYPE.test(node.type);
  return isReturn || (!isNestedFunction && childNodes(node).some(returnsOwn));
};

const statementsOf = (text) => {
  try {
    return parse(text, PARSE_OPTIONS).program.body;
  } catch {
    return null;
  }
};

const parsedReturns = (text) => statementsOf(text)?.some(returnsOwn) ?? true;

// An own return that a `return piece()` call site cannot keep: not the span's unconditional last statement.
const parsedStrands = (text) => {
  const statements = statementsOf(text);
  const isUnparsed = statements === null;
  if (isUnparsed) return true;
  const endsInReturn = statements.at(-1)?.type === 'ReturnStatement';
  return !endsInReturn && statements.some(returnsOwn);
};

/** True when the statements in text return from their own (enclosing) function. */
export const hasOwnReturn = (text) => RETURN_WORD.test(text) && parsedReturns(text);

/** True when text has an own return and does not end in an unconditional `return` statement. */
export const hasStrandingReturn = (text) => RETURN_WORD.test(text) && parsedStrands(text);

/**
 * Span readers over textOf(file, start, end): mayReturnAt is the cheap word test (false means the span
 * surely has no own return), strandsAt the memoized parse (an own return not ending the span).
 */
export const createReturnReader = (textOf) => {
  const cache = new Map();
  const mayReturnAt = (file, start, end) => RETURN_WORD.test(textOf(file, start, end));
  const strandsAt = (file, start, end) => {
    const key = `${file}:${start}:${end}`;
    const isKnown = cache.has(key);
    if (!isKnown) cache.set(key, hasStrandingReturn(textOf(file, start, end)));
    return cache.get(key);
  };
  return { mayReturnAt, strandsAt };
};
