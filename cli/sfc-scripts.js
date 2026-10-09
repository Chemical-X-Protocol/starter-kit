/**
 * Single-file-component script splitter (Vue, Svelte).
 *
 * Returns every <script> block as a position-preserving source: everything before the block
 * body is replaced by spaces (newlines kept), so Babel's line, column and character offsets
 * equal the offsets in the original file. Interim helper until a real SFC parser lands (plan B).
 */

const SCRIPT_BLOCK_REGEX = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LANG_ATTR_REGEX = /\blang\s*=\s*["']([a-z]+)["']/i;

export const isSfcFile = (filePath = '') => {
  const lower = String(filePath).toLowerCase();
  return lower.endsWith('.vue') || lower.endsWith('.svelte');
};

const blankPrefix = (text) => text.replace(/[^\n]/g, ' ');

/**
 * @param {string} content Full SFC source.
 * @returns {Array<{ code: string, start: number, end: number, startLine: number, lang: string }>}
 */
export const extractScriptBlocks = (content) => {
  const blocks = [];
  for (const match of content.matchAll(SCRIPT_BLOCK_REGEX)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const openTagLength = match[0].length - body.length - '</script>'.length;
    const start = (match.index || 0) + openTagLength;
    const end = start + body.length;
    const langMatch = attrs.match(LANG_ATTR_REGEX);
    blocks.push({
      code: blankPrefix(content.slice(0, start)) + body,
      start,
      end,
      startLine: content.slice(0, start).split('\n').length,
      lang: langMatch ? langMatch[1].toLowerCase() : 'js'
    });
  }
  return blocks;
};

/**
 * Blanks everything outside <script> bodies (newlines kept), giving one parseable source whose
 * positions equal the original file's.
 *
 * @param {string} content Full SFC source.
 * @returns {string}
 */
export const blankOutsideScripts = (content) => {
  const blocks = extractScriptBlocks(content);
  let out = '';
  let cursor = 0;
  for (const block of blocks) {
    out += blankPrefix(content.slice(cursor, block.start)) + content.slice(block.start, block.end);
    cursor = block.end;
  }
  return out + blankPrefix(content.slice(cursor));
};
