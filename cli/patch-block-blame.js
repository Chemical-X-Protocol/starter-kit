/**
 * Which block of a multi-block patch makes the guards refuse (K19, #6768).
 *
 * The blocks are applied to one in-memory buffer and the guards (parse, V8 syntax, declaration
 * loss, missing imports) run once on the final text, so a refusal can never leave the file
 * half-applied. The guards cannot say which block earned the refusal, so this module replays the
 * guards on each intermediate buffer, newest first, and blames the first block after which they
 * refuse every buffer up to the end. A later block that mends the problem leaves no refusal to
 * blame, and a refusal that holds before any block ran (a lease, a file V8 already rejects)
 * names no block.
 */
import { EditRefusedError } from './apply-edits.js';

const refusalOf = (check, content) => {
  try {
    check(content);
    return null;
  } catch (err) {
    return err;
  }
};

const isGuardRefusal = (err) => err instanceof EditRefusedError || err?.isRefusal === true;

// "...if intended" and "...nothing was written" both end the same way: one clear closing sentence.
const settled = (text) => (/nothing was written/i.test(text) ? text : `${text.replace(/[.\s]+$/, '')}. Nothing was written.`);

/**
 * @param {(content: string) => void} check Runs every guard on one buffer; throws when it refuses.
 * @param {string} original The file before the patch.
 * @param {string[]} buffers buffers[k] is the text after block k + 1; the last one is the refused result.
 * @returns {number} The 1-based block number, or 0 when no block is to blame.
 */
export const blameBlock = (check, original, buffers) => {
  const isRefusedBeforeAnyBlock = Boolean(refusalOf(check, original));
  if (isRefusedBeforeAnyBlock) return 0;
  let culprit = buffers.length;
  while (culprit > 1 && refusalOf(check, buffers[culprit - 2])) culprit -= 1;
  return culprit;
};

const withBlock = (err, block, blocks) => {
  const isEditRefusal = err instanceof EditRefusedError;
  if (isEditRefusal) {
    return new EditRefusedError(err.issues.map((issue) => ({ ...issue, block, blocks, reason: settled(issue.reason) })));
  }
  return Object.assign(new Error(`Block ${block} of ${blocks}: ${settled(err.message)}`), { isRefusal: true });
};

/**
 * @param {Error} err What the final buffer's guards threw.
 * @param {{ check: Function, original: string, buffers: string[] }} replay The guard replay inputs (see blameBlock).
 * @returns {Error} err, or a copy that names the block (only for a guard refusal of a 2+ block patch).
 */
export const explainBlockRefusal = (err, { check, original, buffers }) => {
  const isBlockPatch = buffers.length > 1;
  const isBlameable = isBlockPatch && isGuardRefusal(err);
  if (!isBlameable) return err;
  const culprit = blameBlock(check, original, buffers);
  return culprit > 0 ? withBlock(err, culprit, buffers.length) : err;
};
