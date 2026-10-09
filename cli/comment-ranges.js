/**
 * Comment and literal ranges from a real tokenizer instead of regexes.
 *
 * JS/TS come from Babel (comments, string/template/regex/JSX text nodes), Vue/Svelte from
 * their script blocks (file positions), CSS/SCSS/LESS from a quote-aware scanner. Callers use
 * comment ranges to strip or edit comments, and literal ranges to keep their hands off strings.
 */
import path from 'node:path';
// Babel loads on first use (babel-lazy.js), so plain reads that never parse skip it.
import { traverse } from './babel-lazy.js';
import { parseBabel, langForPath } from './source-parse.js';
import { extractScriptBlocks, isSfcFile } from './sfc-scripts.js';

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less']);
const LITERAL_TYPES = new Set(['StringLiteral', 'TemplateElement', 'JSXText', 'RegExpLiteral', 'DirectiveLiteral']);

const babelRanges = (code, lang) => {
  const ast = parseBabel(code, lang, { errorRecovery: false });
  const comments = (ast.comments || []).map((c) => ({ start: c.start, end: c.end, kind: c.type === 'CommentLine' ? 'line' : 'block' }));
  const literals = [];
  traverse(ast, {
    enter(nodePath) {
      const isLiteral = LITERAL_TYPES.has(nodePath.node.type);
      if (isLiteral) literals.push({ start: nodePath.node.start, end: nodePath.node.end });
    }
  });
  return { comments, literals };
};

const styleRanges = (code, allowLineComments) => {
  const comments = [];
  const literals = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const isQuote = ch === '"' || ch === '\'';
    const isBlockComment = ch === '/' && code[i + 1] === '*';
    const isLineStart = i === 0 || /\s/.test(code[i - 1]);
    const isLineComment = allowLineComments && ch === '/' && code[i + 1] === '/' && isLineStart;
    if (isQuote) {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      literals.push({ start: i, end: j + 1 });
      i = j + 1;
    } else if (isBlockComment) {
      const close = code.indexOf('*/', i + 2);
      const end = close === -1 ? code.length : close + 2;
      comments.push({ start: i, end, kind: 'block' });
      i = end;
    } else if (isLineComment) {
      const newline = code.indexOf('\n', i);
      const end = newline === -1 ? code.length : newline;
      comments.push({ start: i, end, kind: 'line' });
      i = end;
    } else {
      i++;
    }
  }
  return { comments, literals };
};

/**
 * @param {string} content File text.
 * @param {string} filePath Path (decides the tokenizer).
 * @returns {{ comments: Array<{start:number,end:number,kind:string}>, literals: Array<{start:number,end:number}>, codeRegions: Array<{start:number,end:number}> } | null}
 *   null when the file type is unsupported or does not parse. codeRegions are the spans the
 *   ranges cover (the whole file, or only SFC script blocks).
 */
export const findSourceRanges = (content, filePath) => {
  const ext = path.extname(String(filePath)).toLowerCase();
  try {
    if (isSfcFile(filePath)) {
      const blocks = extractScriptBlocks(content);
      const parts = blocks.map((b) => babelRanges(b.code, b.lang === 'ts' || b.lang === 'tsx' ? b.lang : 'js'));
      return {
        comments: parts.flatMap((p) => p.comments),
        literals: parts.flatMap((p) => p.literals),
        codeRegions: blocks.map((b) => ({ start: b.start, end: b.end }))
      };
    }
    const lang = langForPath(filePath);
    const whole = [{ start: 0, end: content.length }];
    if (lang) return { ...babelRanges(content, lang), codeRegions: whole };
    const isStyle = STYLE_EXTENSIONS.has(ext);
    if (isStyle) return { ...styleRanges(content, ext !== '.css'), codeRegions: whole };
    return null;
  } catch {
    return null;
  }
};

/**
 * Removes comment text but keeps every newline, so line N stays line N.
 *
 * @returns {string|null} null when comments cannot be located safely for this file.
 */
export const stripCommentsKeepingLines = (content, filePath) => {
  const ranges = findSourceRanges(content, filePath);
  if (!ranges) return null;
  let out = '';
  let cursor = 0;
  for (const c of [...ranges.comments].sort((a, b) => a.start - b.start)) {
    out += content.slice(cursor, c.start) + content.slice(c.start, c.end).replace(/[^\n]/g, '');
    cursor = c.end;
  }
  out += content.slice(cursor);
  return out.split('\n').map((line) => line.trimEnd()).join('\n');
};
