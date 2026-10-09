// Own returns of a statement span (engine doc section 5, N2: a window that contains `return` must reach
// the end of the function body). A piece cut out of a body cannot carry a `return` of the enclosing
// function unless it ends that body, so N1 statement instances and N2 windows that return from the middle
// of their block are dropped. Only returns of the span's own function count: a `return` inside a nested
// arrow or function belongs to that function. The span text is parsed on its own (return and await
// allowed outside a function); a span that does not parse alone is judged by the word `return`.
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

const parsedReturns = (text) => {
  try {
    return parse(text, PARSE_OPTIONS).program.body.some(returnsOwn);
  } catch {
    return true;
  }
};

/** True when the statements in text return from their own (enclosing) function. */
export const hasOwnReturn = (text) => RETURN_WORD.test(text) && parsedReturns(text);

/** Memoized hasOwnReturn over (file, start, end) spans; textOf(file, start, end) reads the span. */
export const createReturnReader = (textOf) => {
  const cache = new Map();
  return (file, start, end) => {
    const key = `${file}:${start}:${end}`;
    const isKnown = cache.has(key);
    if (!isKnown) cache.set(key, hasOwnReturn(textOf(file, start, end)));
    return cache.get(key);
  };
};
