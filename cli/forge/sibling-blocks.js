// Sibling blocks for W (engine doc TRUE TRACE, A19: "W, 4 sibling blocks"). A repeated form is often the
// body of sibling statements rather than a run inside one block: the retried `gh discussion create` of
// cli/audit/social-gh.js sits in the consequents of three `if` statements of one function body. Blocks
// whose parent statements share a parent block form a family, and W also buckets windows across the
// blocks of one family. The ledger has no parent column, so the parent statement of a block is the
// innermost stmt row of another block whose span contains the block's first statement.
import { blocksOf } from './windows.js';
import { byCodePoint, pushTo } from './group-shape.js';

const byOuterFirst = (a, b) => byCodePoint(a.file_path, b.file_path) || a.start - b.start || b.end - a.end;

// Map of `${file}#${blockId}` to the block id of its parent statement, from one sweep per file.
const parentBlocksOf = (rows) => {
  const parents = new Map();
  const stack = [];
  const statements = rows.filter((row) => row.kind === 'stmt' && row.start !== null).sort(byOuterFirst);
  for (const row of statements) {
    while (stack.length > 0 && (stack.at(-1).file_path !== row.file_path || stack.at(-1).end <= row.start)) stack.pop();
    const container = stack.at(-1);
    const blockKey = `${row.file_path}#${row.block_id}`;
    const isNestedBlock = Boolean(container) && container.block_id !== row.block_id && !parents.has(blockKey);
    if (isNestedBlock) parents.set(blockKey, container.block_id);
    stack.push(row);
  }
  return parents;
};

/**
 * Families of sibling blocks: arrays of at least 2 blocks (each its stmt rows in source order) whose
 * parent statements sit in the same block of the same file. Families come in code-point order of their key.
 */
export const siblingBlockFamilies = (rows) => {
  const parents = parentBlocksOf(rows);
  const families = new Map();
  for (const [blockKey, blockRows] of blocksOf(rows, 'stmt')) {
    const parentBlock = parents.get(blockKey);
    const hasParent = parentBlock !== undefined;
    if (hasParent) pushTo(families, `${blockRows[0].file_path}#${parentBlock}`, blockRows);
  }
  return [...families.keys()].sort(byCodePoint).map((key) => families.get(key)).filter((blocks) => blocks.length >= 2);
};
