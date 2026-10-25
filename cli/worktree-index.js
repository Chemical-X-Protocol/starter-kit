/**
 * Chemical X Protocol: the index step of `chemx worktree add` (#6769, K8b).
 * Opens the new worktree's own index db (created, and stamped for the worktree root, by the open) and
 * seeds it from the main checkout's rows (index-seed.js), so the first q there parses only the files
 * that differ. The open runs with CHEMX_PROJECT_ROOT set to the worktree root for its duration: an
 * exported root (or --root) would otherwise send the open to another project's db. One output line for
 * a seed or a skipped seed; none when there is nothing to seed from.
 */
import { openIndexDb } from './search-schema.js';
import { seedIndexFromParent, describeSeed } from './index-seed.js';

const ROOT_ENV = 'CHEMX_PROJECT_ROOT';

const withProjectRootEnv = (root, fn) => {
  const previous = process.env[ROOT_ENV];
  process.env[ROOT_ENV] = root;
  try {
    return fn();
  } finally {
    const hadPrevious = previous !== undefined;
    if (hadPrevious) process.env[ROOT_ENV] = previous;
    else delete process.env[ROOT_ENV];
  }
};

/** @returns the seedIndexFromParent result for the worktree at worktreeRoot */
export const seedWorktreeIndex = (worktreeRoot) => withProjectRootEnv(worktreeRoot, () => {
  const db = openIndexDb(worktreeRoot, { fresh: true });
  const hasDb = Boolean(db);
  if (!hasDb) return { status: 'none', reason: 'sqlite is unavailable' };
  return seedIndexFromParent(db, worktreeRoot);
});

/** The `index:` line of `worktree add`, or '' when there is nothing to say. */
export const formatSeedLine = (seed) => {
  const text = describeSeed(seed);
  const hasText = text !== '';
  if (!hasText) return '';
  const isSeeded = seed.status === 'seeded';
  const timing = isSeeded ? ` (${seed.ms}ms)` : '';
  return `index: ${text}${timing}\n`;
};
