/**
 * Svelte components through the shared SFC shape (#1743). Svelte allows only
 * top-level <script> blocks (instance and module), so their boundaries are found
 * without a Svelte compiler; the markup is blanked out of the script overlay and is
 * not analysed (template: null). Same return shape as parseSfc for .vue files.
 */
const SCRIPT_BLOCK = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/g;
const LANG_ATTR = /\blang\s*=\s*["']?([\w-]+)/;
const SRC_ATTR = /\bsrc\s*=\s*["']?([^"'\s>]+)/;

const lineAt = (content, offset) => {
  let line = 1;
  for (let i = 0; i < offset; i += 1) line += content[i] === '\n' ? 1 : 0;
  return line;
};

const toScriptBlock = (content, match) => {
  const attrs = match[1] || '';
  const body = match[2];
  const startOffset = match.index + match[0].indexOf('>') + 1;
  const endOffset = startOffset + body.length;
  return {
    content: body,
    lang: attrs.match(LANG_ATTR)?.[1] || 'js',
    isSetup: false,
    isModule: /\bcontext\s*=\s*["']?module|\bmodule\b/.test(attrs),
    src: attrs.match(SRC_ATTR)?.[1] || null,
    startOffset,
    endOffset,
    startLine: lineAt(content, match.index),
    endLine: lineAt(content, endOffset)
  };
};

/** buildScriptOverlay is passed in to keep one overlay implementation (sfc-parse.js). */
export const parseSvelteSfc = (content, buildScriptOverlay) => {
  const scripts = [...content.matchAll(SCRIPT_BLOCK)].map((match) => toScriptBlock(content, match));
  const inlineScripts = scripts.filter((s) => !s.src);
  return {
    errors: [],
    scripts,
    template: null,
    styles: [],
    scriptOverlay: inlineScripts.length > 0 ? buildScriptOverlay(content, inlineScripts) : ''
  };
};
