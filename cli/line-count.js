/**
 * Line counting that agrees with editors: a trailing newline ends the last line, it does not
 * start an extra empty one. 'a\n' is 1 line, 'a' is 1 line, '' is 0 lines.
 */

/**
 * @param {string} text File text.
 * @returns {string[]} The file's lines, without the phantom entry after a final newline.
 */
export const splitFileLines = (text) => {
  const isEmpty = text === '';
  if (isEmpty) return [];
  const lines = text.split('\n');
  const hasFinalNewline = lines[lines.length - 1] === '';
  if (hasFinalNewline) lines.pop();
  return lines;
};

/**
 * @param {string} text File text.
 * @returns {number}
 */
export const countLines = (text) => splitFileLines(text).length;
