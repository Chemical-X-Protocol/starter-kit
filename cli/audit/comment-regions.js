/**
 * Where comments sit on a source line, outside string literals, so a `chemx-allow:` marker
 * quoted in a string never counts as an annotation. One pass per line; the state carries an
 * open block comment and an open template literal into the next line.
 *
 * Known gaps (they err towards flagging): a lone apostrophe in markup text or a quote inside
 * a regex literal opens a string for the rest of that line, and C# verbatim strings are read
 * with backslash escapes.
 */
const BLOCK_OPENERS = [['/*', '*/'], ['<!--', '-->']];
const QUOTES = new Set(['"', "'", '`']);
const BACKSLASH = '\\';
const CARRIED_QUOTE = '`';

export const INITIAL_SCAN_STATE = Object.freeze({ inBlock: false, blockCloser: null, quote: null });

const findBlockOpener = (line, index) => BLOCK_OPENERS.find(([opener]) => line.startsWith(opener, index));

const isHashComment = (line, index) => line[index] === '#' && (index === 0 || /\s/.test(line[index - 1]));

const isLineCommentStart = (line, index) => line.startsWith('//', index) || isHashComment(line, index);

// Index just past the string that is open at index (quote already consumed), or -1 when it
// runs past the end of the line.
const skipString = (line, index, quote) => {
  let cursor = index;
  while (cursor < line.length) {
    const char = line[cursor];
    const isEscape = char === BACKSLASH;
    const isClosingQuote = char === quote;
    if (isClosingQuote) return cursor + 1;
    cursor += isEscape ? 2 : 1;
  }
  return -1;
};

/**
 * Comment regions on one line as [start, end) column pairs, the string literals outside them
 * (strings, quotes included; one carried in from the line above starts at 0, and one still open
 * runs to the line end), and the state for the next line.
 */
export const scanCommentRegions = (line, state = INITIAL_SCAN_STATE) => {
  const regions = [];
  const strings = [];
  let { inBlock, blockCloser, quote } = state;
  let regionStart = 0;
  let stringStart = 0;
  let index = 0;
  while (index < line.length) {
    if (inBlock) {
      const closeAt = line.indexOf(blockCloser, index);
      const isStillOpen = closeAt === -1;
      if (isStillOpen) break;
      regions.push([regionStart, closeAt + blockCloser.length]);
      index = closeAt + blockCloser.length;
      inBlock = false;
      continue;
    }
    if (quote) {
      const afterString = skipString(line, index, quote);
      const isUnterminated = afterString === -1;
      if (isUnterminated) break;
      strings.push([stringStart, afterString]);
      quote = null;
      index = afterString;
      continue;
    }
    if (isLineCommentStart(line, index)) {
      regions.push([index, line.length]);
      index = line.length;
      break;
    }
    const block = findBlockOpener(line, index);
    if (block) {
      inBlock = true;
      blockCloser = block[1];
      regionStart = index;
      index += block[0].length;
      continue;
    }
    const isQuote = QUOTES.has(line[index]);
    if (isQuote) {
      quote = line[index];
      stringStart = index;
    }
    index += 1;
  }
  if (inBlock) regions.push([regionStart, line.length]);
  if (quote) strings.push([stringStart, line.length]);
  const carriedQuote = quote === CARRIED_QUOTE ? quote : null;
  return { regions, strings, state: { inBlock, blockCloser: inBlock ? blockCloser : null, quote: carriedQuote } };
};
