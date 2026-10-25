/**
 * SEARCH/REPLACE blocks for `chemx patch <file> <<'EOF'` and MCP patch `blocks[]`.
 *
 *   <<<<<<< SEARCH        (marker lines are built with repeat() below so this file never
 *   exact old text         looks like an unmerged conflict to chemx or git)
 *   =======
 *   new text
 *   >>>>>>> REPLACE
 *
 * Blocks apply in order to one in-memory copy; any failure throws before anything is written,
 * so a multi-block patch is all-or-nothing. CRLF input is read as LF (replaceLiteral re-applies
 * CRLF on CRLF files). An empty REPLACE deletes the SEARCH lines including their newline.
 *
 * Conflict markers (#6773): a block may hold more than one divider line (SEARCH text from a botched
 * merge has its own divider). The first divider is the default split; every divider is kept as an
 * alternative, and when the block is applied the file decides: the split whose SEARCH text occurs in
 * it, the longest one first. A block with one divider is exactly { search, replace }.
 */
import { replaceLiteral } from './literal-replace.js';

const OPEN = `${'<'.repeat(7)} SEARCH`;
const MID = '='.repeat(7);
const CLOSE = `${'>'.repeat(7)} REPLACE`;
export const BLOCK_MARKERS = { OPEN, MID, CLOSE };

const FORMAT_HINT = `expected one or more blocks: ${OPEN} / old text / ${MID} / new text / ${CLOSE}, each marker on its own line at column 0 (use 8+ characters on all three markers to edit text that contains markers)`;

const nextMarker = (lines, from, marker) => {
  for (let i = from; i < lines.length; i++) {
    const isMarkerLine = lines[i].trimEnd() === marker;
    if (isMarkerLine) return i;
  }
  return -1;
};

// A longer fence (8+ '<') pairs with dividers of the same length, so a block can edit text
// that itself contains 7-character SEARCH/REPLACE markers (docs, specs, this file's callers).
const OPEN_REGEX = /^(<{7,}) SEARCH\s*$/;
const nextOpen = (lines, from) => {
  for (let i = from; i < lines.length; i++) {
    const match = OPEN_REGEX.exec(lines[i]);
    if (match) return { index: i, width: match[1].length };
  }
  return null;
};

const splitAt = (lines, open, divider, close) => ({ search: lines.slice(open + 1, divider).join('\n'), replace: lines.slice(divider + 1, close).join('\n') });

// Every divider line between the first one and the close marker is another place the SEARCH text may end.
const blockFrom = (lines, { open, mid, close, midMarker }) => {
  const extra = lines.slice(mid + 1, close).flatMap((line, i) => (line.trimEnd() === midMarker ? [mid + 1 + i] : []));
  const dividers = [mid, ...extra];
  const hasConflictDividers = dividers.length > 1;
  const first = splitAt(lines, open, mid, close);
  return hasConflictDividers ? { ...first, alternatives: dividers.map((divider) => splitAt(lines, open, divider, close)) } : first;
};

/**
 * @param {string} text Raw stdin text.
 * @returns {{ search: string, replace: string, alternatives?: { search: string, replace: string }[] }[]}
 */
export const parseSearchReplaceBlocks = (text) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const blocks = [];
  let open = nextOpen(lines, 0);
  while (open) {
    const n = blocks.length + 1;
    const midMarker = '='.repeat(open.width);
    const closeMarker = `${'>'.repeat(open.width)} REPLACE`;
    const mid = nextMarker(lines, open.index + 1, midMarker);
    const isMissingDivider = mid === -1;
    if (isMissingDivider) throw new Error(`Block ${n}: no "${midMarker}" divider after the SEARCH marker (input line ${open.index + 1}); ${FORMAT_HINT}.`);
    const close = nextMarker(lines, mid + 1, closeMarker);
    const isMissingClose = close === -1;
    if (isMissingClose) throw new Error(`Block ${n}: no "${closeMarker}" after the divider (input line ${mid + 1}); ${FORMAT_HINT}.`);
    blocks.push(blockFrom(lines, { open: open.index, mid, close, midMarker }));
    open = nextOpen(lines, close + 1);
  }
  const hasNoBlocks = blocks.length === 0;
  if (hasNoBlocks) throw new Error(`No SEARCH/REPLACE blocks found on stdin; ${FORMAT_HINT}.`);
  return blocks;
};

const commonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/**
 * The file line most like the first non-blank SEARCH line, for "not found" errors.
 *
 * @returns {{ line: number, text: string } | null}
 */
export const closestLine = (content, search) => {
  const probe = search.split('\n').map((l) => l.trim()).find(Boolean);
  if (!probe) return null;
  let best = null;
  content.split(/\r?\n/).forEach((raw, i) => {
    const text = raw.trim();
    const score = text === probe ? Infinity : commonPrefix(text, probe);
    const isBetter = score > 0 && (!best || score > best.score);
    if (isBetter) best = { line: i + 1, text: raw, score };
  });
  return best ? { line: best.line, text: best.text } : null;
};

const occursIn = (content, search) => content.includes(search) || content.replace(/\r\n/g, '\n').includes(search);

// The split a file really contains: the longest non-empty SEARCH that occurs in it, else the default (first) split.
const chooseSplit = (content, block) => {
  const found = (block.alternatives ?? []).filter((split) => split.search.trim() !== '' && occursIn(content, split.search));
  const longest = found.reduce((best, split) => (best && best.search.length >= split.search.length ? best : split), null);
  return longest ?? block;
};

const applyOne = (content, block, options) => {
  const chosen = chooseSplit(content, block);
  const isDeletion = chosen.replace === '' && content.includes(`${chosen.search}\n`);
  const search = isDeletion ? `${chosen.search}\n` : chosen.search;
  return replaceLiteral(content, search, chosen.replace, options);
};

/**
 * @param {string} content File content.
 * @param {{ search: string, replace: string }[]} blocks Parsed blocks.
 * @param {object} [options] { allowMultiple, filePath }
 * @returns {{ content: string, count: number, lines: number[], changedLines: object, eol: string, blocks: number, buffers: string[] }}
 * buffers[k] is the text after block k + 1, so a guard that refuses the final text can be replayed per block.
 */
export const applySearchReplaceBlocks = (content, blocks, options = {}) => {
  let current = content;
  const buffers = [];
  const results = blocks.map((block, i) => {
    try {
      const res = applyOne(current, block, options);
      current = res.content;
      buffers.push(current);
      return res;
    } catch (err) {
      const near = closestLine(current, String(block.search ?? ''));
      const hint = near ? ` Closest line: ${near.line}| ${near.text.trim()}` : '';
      throw new Error(`Block ${i + 1} of ${blocks.length}: ${err.message}${hint} Nothing was written.`);
    }
  });
  const first = results[0];
  const count = results.reduce((sum, r) => sum + r.count, 0);
  return { content: current, count, lines: first.lines, changedLines: first.changedLines, eol: first.eol, blocks: blocks.length, buffers };
};
