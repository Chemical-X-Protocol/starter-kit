/**
 * Minimal JSONC reader for MCP config files.
 * Strips // and block comments and trailing commas outside strings, then JSON.parse.
 * Reports whether comments were present so callers can refuse a lossy rewrite.
 */

const scanOutsideStrings = (text, onCode) => {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      const isEscape = ch === '\\';
      if (isEscape) { out += text[i + 1] ?? ''; i++; continue; }
      const closesString = ch === '"';
      if (closesString) inString = false;
      continue;
    }
    const opensString = ch === '"';
    if (opensString) { inString = true; out += ch; continue; }
    const step = onCode(text, i);
    out += step.emit;
    i += step.skip;
  }
  return out;
};

const stripComments = (text) => {
  let hasComments = false;
  const code = scanOutsideStrings(text, (src, i) => {
    const isLineComment = src.startsWith('//', i);
    const isBlockComment = src.startsWith('/*', i);
    if (isLineComment) {
      hasComments = true;
      const end = src.indexOf('\n', i);
      return { emit: '', skip: (end === -1 ? src.length : end) - i - 1 };
    }
    if (isBlockComment) {
      hasComments = true;
      const end = src.indexOf('*/', i + 2);
      return { emit: ' ', skip: (end === -1 ? src.length : end + 2) - i - 1 };
    }
    return { emit: src[i], skip: 0 };
  });
  return { code, hasComments };
};

const stripTrailingCommas = (code) => scanOutsideStrings(code, (src, i) => {
  const isComma = src[i] === ',';
  const nextCode = isComma ? src.slice(i + 1).trimStart()[0] : '';
  const isTrailing = nextCode === '}' || nextCode === ']';
  return { emit: isTrailing ? '' : src[i], skip: 0 };
});

/** Returns [value, error, { hasComments }]. Never throws. */
export const parseJsonc = (text = '') => {
  const { code, hasComments } = stripComments(String(text));
  try {
    return [JSON.parse(stripTrailingCommas(code)), null, { hasComments }];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err)), { hasComments }];
  }
};
