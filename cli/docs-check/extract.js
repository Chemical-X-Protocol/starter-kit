/**
 * Docs check extractor: finds chemx invocations in markdown without running anything.
 * Reads inline code spans and fenced blocks. A span or shell line counts only when a
 * command segment starts with `chemx` (optionally after `$`, env assignments, `pnpm`,
 * `npx`), so prose that merely mentions chemx is never parsed as a command.
 * MCP calls are read from `chemx({ action: ... })`, `command:` and `commands: [...]`.
 */

const FENCE_OPEN = /^\s*(```|~~~)\s*([\w-]*)/;
const SHELL_LANGS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console', 'text', 'txt']);
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;
const LEADING_NOISE = /^(?:\$\s+|>\s+|(?:[A-Z_][A-Z0-9_]*=\S*\s+)+|(?:pnpm(?:\s+exec)?|npx)\s+)+/;
const WORD_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const MCP_CALL = /chemx\(\s*\{/;
const MCP_ACTION = /\baction:\s*["'`]([\w-]+)["'`]/;
const MCP_COMMAND = /\bcommand:\s*(?:"([^"]*)"|'([^']*)')/;
const MCP_COMMANDS = /\bcommands:\s*\[([^\]]*)\]/;
const LOOKAHEAD_LINES = 3;
const SHOWN_LIMIT = 90;

/** Split a command string into { text, quoted } words, stopping at a comment or redirect. */
export const tokenize = (input) => {
  const words = [];
  for (const match of input.matchAll(WORD_PATTERN)) {
    const isQuoted = match[1] !== undefined || match[2] !== undefined;
    const text = match[1] ?? match[2] ?? match[3];
    const isStop = !isQuoted && (text.startsWith('#') || /^\d?>/.test(text));
    if (isStop) break;
    words.push({ text, quoted: isQuoted });
  }
  return words;
};

/** Positional words before the first flag or quoted argument. */
const positionalPrefix = (words) => {
  const stopAt = words.findIndex((w) => w.quoted || w.text.startsWith('-'));
  const prefix = stopAt === -1 ? words : words.slice(0, stopAt);
  return prefix.map((w) => w.text);
};

const shown = (tail) => `chemx ${tail}`.trim().slice(0, SHOWN_LIMIT);

const cliInvocation = (line, tail) => {
  const words = tokenize(tail);
  return { kind: 'cli', line, text: shown(tail), words: positionalPrefix(words), rawWords: words };
};

/** `chemx do "d" "p -s"` runs each quoted argument as a chemx command. */
const batchInvocations = (line, base) => {
  const isBatch = base.words[0] === 'do';
  if (!isBatch) return [];
  return base.rawWords
    .filter((w) => w.quoted)
    .map((w) => cliInvocation(line, w.text.trim()));
};

// `chemx root: <dir>` is printed output, not a command: a first word ending in a colon is a label.
const OUTPUT_LABEL = /^[\w-]+:(?:\s|$)/;

const segmentTail = (segment) => {
  const cleaned = segment.trim().replace(LEADING_NOISE, '');
  const startsWithChemx = /^chemx(?:\s|$)/.test(cleaned);
  const tail = startsWithChemx ? cleaned.slice('chemx'.length).trim() : null;
  const isLabel = tail !== null && OUTPUT_LABEL.test(tail);
  return isLabel ? null : tail;
};

// A shell comment runs to the end of the line, so `# ...; chemx x` is prose.
const COMMENT_TAIL = /(^|\s)#.*$/;

const fromCommandText = (line, text) => {
  const out = [];
  for (const segment of text.replace(COMMENT_TAIL, '').split(SEGMENT_SPLIT)) {
    const tail = segmentTail(segment);
    const hasTail = tail !== null && tail.length > 0;
    if (!hasTail) continue;
    const base = cliInvocation(line, tail);
    out.push(base, ...batchInvocations(line, base));
  }
  return out;
};

const stringsIn = (listText) => [...listText.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);

/** Read one `chemx({ ... })` call from a window of text. */
const fromMcpWindow = (line, windowText) => {
  const callAt = windowText.search(MCP_CALL);
  const hasCall = callAt !== -1;
  if (!hasCall) return [];
  const body = windowText.slice(callAt);
  const out = [];
  const action = MCP_ACTION.exec(body);
  if (action) out.push({ kind: 'mcp', line, text: `chemx({ action: "${action[1]}" })`, action: action[1] });
  const command = MCP_COMMAND.exec(body);
  if (command) out.push(cliInvocation(line, (command[1] ?? command[2]).trim()));
  const commands = MCP_COMMANDS.exec(body);
  const listed = commands ? stringsIn(commands[1]) : [];
  for (const item of listed) out.push(cliInvocation(line, item.trim()));
  return out;
};

const spanTexts = (lineText) => [...lineText.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

const scanFenceLine = (lines, index, lang) => {
  const lineNo = index + 1;
  const windowText = lines.slice(index, index + 1 + LOOKAHEAD_LINES).join(' ');
  const mcp = fromMcpWindow(lineNo, windowText);
  const hasCallHere = MCP_CALL.test(lines[index]);
  const mcpHere = hasCallHere ? mcp : [];
  const isShell = SHELL_LANGS.has(lang);
  const cli = isShell ? fromCommandText(lineNo, lines[index]) : [];
  return [...cli, ...mcpHere];
};

const scanProseLine = (lineText, lineNo) => {
  const out = [];
  for (const span of spanTexts(lineText)) {
    out.push(...fromCommandText(lineNo, span), ...fromMcpWindow(lineNo, span));
  }
  return out;
};

/**
 * Advance the fence state by one line. `kind` says what the line is:
 * 'fence' (an opening or closing marker), 'code' (inside a fence) or 'prose'.
 */
const advanceFence = (state, lineText) => {
  const open = FENCE_OPEN.exec(lineText);
  const isMarker = open !== null;
  const isInside = state.marker !== null;
  const isClosing = isMarker && isInside && open[1] === state.marker;
  const isOpening = isMarker && !isInside;
  if (isClosing) return { marker: null, lang: '', kind: 'fence' };
  if (isOpening) return { marker: open[1], lang: open[2].toLowerCase(), kind: 'fence' };
  return { marker: state.marker, lang: state.lang, kind: isInside ? 'code' : 'prose' };
};

/** @returns {Array<{kind:'cli'|'mcp', line:number, text:string, words?:string[], action?:string}>} */
export const extractInvocations = (markdown) => {
  const lines = markdown.split('\n');
  const found = [];
  let state = { marker: null, lang: '', kind: 'prose' };
  lines.forEach((lineText, index) => {
    state = advanceFence(state, lineText);
    const isCode = state.kind === 'code';
    const isProse = state.kind === 'prose';
    if (isCode) found.push(...scanFenceLine(lines, index, state.lang));
    if (isProse) found.push(...scanProseLine(lineText, index + 1));
  });
  return found;
};
