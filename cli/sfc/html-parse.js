/**
 * Standalone HTML document splitter: extracts inline/external <script> and <style> blocks
 * using the same return shape as Vue and Svelte SFC parsing.
 */
const SCRIPT_BLOCK = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>/gi;
const TYPE_ATTR = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const LANG_ATTR = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const JS_SCRIPT_TYPES = new Set([
  '',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'module'
]);

const lineAt = (content, offset) => {
  let line = 1;
  let pos = -1;
  while (true) {
    pos = content.indexOf('\n', pos + 1);
    const isDone = pos === -1 || pos >= offset;
    if (isDone) break;
    line += 1;
  }
  return line;
};

const readAttr = (attrs, pattern) => {
  const match = attrs.match(pattern);
  if (!match) return '';
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
};

const toScriptBlock = (content, match) => {
  const attrs = match[1] || '';
  const body = match[2] || '';
  const openTagEnd = match[0].indexOf('>') + 1;
  const startOffset = match.index + openTagEnd;
  const endOffset = startOffset + body.length;
  const rawType = readAttr(attrs, TYPE_ATTR).toLowerCase();
  const scriptType = rawType.split(';')[0].trim();
  const src = readAttr(attrs, SRC_ATTR) || null;
  const langAttr = readAttr(attrs, LANG_ATTR).toLowerCase();
  return {
    content: body,
    lang: langAttr || 'js',
    isSetup: false,
    isModule: scriptType === 'module',
    type: scriptType || null,
    src,
    startOffset,
    endOffset,
    startLine: lineAt(content, match.index),
    endLine: lineAt(content, endOffset),
    charCount: body.length
  };
};

const toStyleBlock = (content, match) => {
  const attrs = match[1] || '';
  const body = match[2] || '';
  const openTagEnd = match[0].indexOf('>') + 1;
  const startOffset = match.index + openTagEnd;
  const endOffset = startOffset + body.length;
  const langAttr = readAttr(attrs, LANG_ATTR).toLowerCase();
  return {
    lang: langAttr || 'css',
    startLine: lineAt(content, match.index),
    endLine: lineAt(content, endOffset),
    content: body,
    charCount: body.length
  };
};

const isInlineJsScript = (block) => {
  const hasExternalSrc = Boolean(block.src);
  if (hasExternalSrc) return false;
  const scriptType = block.type || '';
  return JS_SCRIPT_TYPES.has(scriptType);
};

/** Parses standalone .html files into the shared SFC shape without throwing. */
export const parseHtmlSfc = (content, buildScriptOverlay) => {
  const scripts = [...content.matchAll(SCRIPT_BLOCK)].map((match) => toScriptBlock(content, match));
  const styles = [...content.matchAll(STYLE_BLOCK)].map((match) => toStyleBlock(content, match));
  const inlineScripts = scripts.filter(isInlineJsScript);
  return {
    errors: [],
    scripts,
    template: null,
    styles,
    scriptOverlay: inlineScripts.length > 0 ? buildScriptOverlay(content, inlineScripts) : ''
  };
};
