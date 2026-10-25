/**
 * Chemical X Protocol: the small YAML subset a task file (`task add --from file.yaml`) is written in (K14, #6759).
 * chemx has no YAML dependency, so this reads exactly what a list of task rows needs: a block list of mappings
 * (or a mapping holding one), plain, 'single' and "double" quoted scalars, integers, booleans and null,
 * `[a, b]` lists, `- item` lists under a key, `|` and `>` block text, `#` comments and a leading `---`.
 * Guaranteed: it returns `{ value }` or `{ error }` naming the line, and never guesses; anything outside the
 * subset (anchors, aliases, tags, `{}` mappings, a list inside a list item, multi-line quoted text, tabs in
 * indentation) is an error. Not guaranteed: full YAML 1.2 conformance (a file the subset accepts is read the
 * way YAML reads it; one it refuses may still be valid YAML).
 */

const KEY_LINE = /^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*))?$/;
const ITEM_LINE = /^-(\s|$)/;
const BLOCK_HEADER = /^[|>][+-]?$/;
const INTEGER = /^[-+]?\d+$/;
const UNSUPPORTED_START = /^[{&*!]/;
const PLAIN_WORDS = new Map([['true', true], ['false', false], ['null', null], ['~', null]]);

class YamlLiteError extends Error {}

const indentOf = (line) => line.length - line.trimStart().length;
const isQuoteChar = (char) => char === '"' || char === "'";
const isItemText = (text) => ITEM_LINE.test(text);

/** The quote state after `char`: a quote opens when none is open and closes when it matches the open one. */
const nextQuote = (quote, char) => {
  const opens = quote === null && isQuoteChar(char);
  if (opens) return char;
  return char === quote ? null : quote;
};

/** Cuts ` # comment` from a value; a # inside quotes stays. */
const stripComment = (text) => {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const isComment = text[i] === '#' && quote === null && (i === 0 || /\s/.test(text[i - 1]));
    if (isComment) return text.slice(0, i);
    quote = nextQuote(quote, text[i]);
  }
  return text;
};

/** Index of the quote that closes the one at text[0], or -1. */
const closingQuote = (text, quote) => {
  let i = 1;
  while (i < text.length) {
    const isEscape = quote === '"' && text[i] === '\\';
    const isDoubled = quote === "'" && text[i] === "'" && text[i + 1] === "'";
    const isClose = text[i] === quote && !isDoubled;
    if (isClose) return i;
    i += isEscape || isDoubled ? 2 : 1;
  }
  return -1;
};

const splitFlow = (inner) => {
  const parts = [];
  let current = '';
  let quote = null;
  for (const char of inner) {
    const isSeparator = char === ',' && quote === null;
    quote = nextQuote(quote, char);
    parts.push(...(isSeparator ? [current] : []));
    current = isSeparator ? '' : current + char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part, index, all) => part !== '' || index < all.length - 1);
};

const plainValue = (text) => {
  const isNumber = INTEGER.test(text);
  if (isNumber) return Number(text);
  return PLAIN_WORDS.has(text) ? PLAIN_WORDS.get(text) : text;
};

export const parseYamlLite = (source) => {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let at = 0;
  const fail = (message, index = at) => { throw new YamlLiteError(`line ${index + 1}: ${message}`); };
  const isEnd = () => at >= lines.length;
  const isSkippable = (line) => line.trim() === '' || line.trim().startsWith('#');
  const skip = () => {
    while (!isEnd() && isSkippable(lines[at])) at++;
  };

  const quoted = (text, index) => {
    const quote = text[0];
    const end = closingQuote(text, quote);
    const isClosed = end === text.length - 1;
    if (!isClosed) fail('a quoted value must close on the same line', index);
    return quote === "'" ? text.slice(1, end).replace(/''/g, "'") : JSON.parse(text);
  };

  const scalar = (raw, index) => {
    const text = raw.trim();
    const isQuoted = isQuoteChar(text[0]);
    if (isQuoted) return quoted(text, index);
    const isFlowList = text.startsWith('[');
    const isUnclosed = isFlowList && !text.endsWith(']');
    if (isUnclosed) fail('a [list] must close on the same line', index);
    if (isFlowList) return splitFlow(text.slice(1, -1)).map((part) => scalar(part, index));
    const isUnsupported = UNSUPPORTED_START.test(text);
    if (isUnsupported) fail('mappings in braces, anchors, aliases and tags are not supported', index);
    return plainValue(text);
  };

  const blockScalar = (header, parentIndent) => {
    const body = [];
    let blockIndent = null;
    while (!isEnd()) {
      const line = lines[at];
      const isBlank = line.trim() === '';
      const endsBlock = !isBlank && (indentOf(line) <= parentIndent || (blockIndent !== null && indentOf(line) < blockIndent));
      if (endsBlock) break;
      const startsBody = !isBlank && blockIndent === null;
      blockIndent = startsBody ? indentOf(line) : blockIndent;
      body.push(isBlank ? '' : line.slice(blockIndent));
      at++;
    }
    let trailing = 0;
    while (body.length > 0 && body[body.length - 1] === '') {
      body.pop();
      trailing++;
    }
    const joined = body.join('\n');
    const folded = header[0] === '>' ? joined.replace(/([^\n])\n(?=[^\n])/g, '$1 ') : joined;
    const ends = { '-': '', '+': '\n'.repeat(trailing + 1) };
    return folded + (ends[header[1]] ?? '\n');
  };

  const block = (minIndent) => {
    skip();
    if (isEnd()) return null;
    const indent = indentOf(lines[at]);
    const isShallow = indent < minIndent;
    if (isShallow) return null;
    const text = lines[at].trim();
    if (isItemText(text)) return sequence(indent);
    const isKeyed = KEY_LINE.test(text);
    if (isKeyed) return mapping(indent);
    return fail('expected a list item or a key: value line');
  };

  const valueAfterKey = (valueText, indent, index) => {
    const text = stripComment(valueText).trim();
    const hasInlineValue = text !== '';
    const isBlockText = BLOCK_HEADER.test(text);
    if (isBlockText) return blockScalar(text, indent);
    if (hasInlineValue) return scalar(text, index);
    skip();
    if (isEnd()) return null;
    const nextIndent = indentOf(lines[at]);
    const isNested = nextIndent > indent;
    if (isNested) return block(nextIndent);
    const isSameIndentList = nextIndent === indent && isItemText(lines[at].trim());
    return isSameIndentList ? sequence(indent) : null;
  };

  const mapping = (indent) => {
    const map = {};
    while (true) {
      skip();
      if (isEnd()) break;
      const lineIndent = indentOf(lines[at]);
      const isOver = lineIndent > indent;
      if (isOver) fail('unexpected indentation');
      const isEnded = lineIndent < indent;
      if (isEnded) break;
      const match = KEY_LINE.exec(lines[at].trim());
      if (!match) fail('expected key: value');
      const isDuplicate = Object.hasOwn(map, match[1]);
      if (isDuplicate) fail(`duplicate key "${match[1]}"`);
      const index = at;
      at++;
      map[match[1]] = valueAfterKey(match[2] ?? '', indent, index);
    }
    return map;
  };

  const sequence = (indent) => {
    const items = [];
    while (true) {
      skip();
      if (isEnd()) break;
      const line = lines[at];
      const lineIndent = indentOf(line);
      const isOver = lineIndent > indent;
      if (isOver) fail('unexpected indentation');
      const isItem = lineIndent === indent && isItemText(line.trim());
      if (!isItem) break;
      const rest = line.trim().slice(1).trimStart();
      const index = at;
      const isBare = rest === '';
      const isNestedList = isItemText(rest);
      const startsMapping = KEY_LINE.test(stripComment(rest).trim());
      if (isNestedList) fail('a list inside a list item is not supported');
      if (isBare) {
        at++;
        items.push(block(indent + 1));
      } else if (startsMapping) {
        const column = line.indexOf(rest, indent + 1);
        lines[at] = `${' '.repeat(column)}${rest}`;
        items.push(mapping(column));
      } else {
        at++;
        items.push(scalar(stripComment(rest), index));
      }
    }
    return items;
  };

  try {
    const tabbed = lines.findIndex((line) => /^\s*\t/.test(line));
    const hasTab = tabbed !== -1;
    if (hasTab) fail('tabs cannot indent YAML; use spaces', tabbed);
    skip();
    const hasMarker = !isEnd() && lines[at].trim() === '---';
    if (hasMarker) at++;
    const value = block(0);
    skip();
    if (!isEnd()) fail('unexpected content after the document');
    return value === null ? { error: 'the file is empty' } : { value };
  } catch (err) {
    const isYamlError = err instanceof YamlLiteError;
    if (isYamlError) return { error: err.message };
    throw err;
  }
};
