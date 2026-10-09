// Function-body ends for the return rule (exits.js, engine doc section 5, N2): a statement span with an
// own `return` may be cut out only when its last statement is the last statement of the enclosing
// function's body, since then nothing runs after the piece. Ending a loop or `if` body does not count.
// Each file is parsed once per run (the module, or the SFC script overlay, which keeps file offsets) and
// every function body's last statement is remembered by its start:end offsets.
import { isSfcFile, parseSfc } from '../sfc/sfc-parse.js';
import { parseScriptAsts } from '../sfc/script-asts.js';

const FUNCTION_TYPE = /Function|Method/;
const SKIPPED_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

const isNode = (value) => Boolean(value) && typeof value.type === 'string';

const childNodes = (node) => Object.keys(node)
  .filter((key) => !SKIPPED_KEYS.has(key))
  .flatMap((key) => [node[key]].flat())
  .filter(isNode);

const spanKey = (start, end) => `${start}:${end}`;

const lastBodyStatementOf = (node) => {
  const isFunction = FUNCTION_TYPE.test(node.type) && node.body?.type === 'BlockStatement';
  return isFunction ? node.body.body.at(-1) ?? null : null;
};

const collectEnds = (ast, ends) => {
  const stack = [ast.program];
  while (stack.length > 0) {
    const node = stack.pop();
    const last = lastBodyStatementOf(node);
    if (last) ends.add(spanKey(last.start, last.end));
    stack.push(...childNodes(node));
  }
};

const endsOfFile = (relativePath, content) => {
  const ends = new Set();
  const sfc = isSfcFile(relativePath) ? parseSfc(content, relativePath) : null;
  const code = sfc ? sfc.scriptOverlay : content;
  const hasCode = code.trim().length > 0;
  const asts = hasCode ? parseScriptAsts(code, sfc, content).asts : [];
  asts.forEach((ast) => collectEnds(ast, ends));
  return ends;
};

const safeEndsOf = (relativePath, content) => {
  try {
    return endsOfFile(relativePath, content);
  } catch {
    return new Set();
  }
};

/**
 * Reader over readFile(relativePath) => text | null. endsFunctionBody(row) is true when the stmt row
 * (file_path, start, end) is the last statement of a function body; an unreadable file has none.
 */
export const createBodyEndReader = (readFile) => {
  const files = new Map();
  const endsOf = (relativePath) => {
    const isCached = files.has(relativePath);
    if (isCached) return files.get(relativePath);
    const content = readFile(relativePath);
    const ends = content === null ? new Set() : safeEndsOf(relativePath, content);
    files.set(relativePath, ends);
    return ends;
  };
  const endsFunctionBody = (row) => endsOf(row.file_path).has(spanKey(row.start, row.end));
  return { endsFunctionBody };
};
