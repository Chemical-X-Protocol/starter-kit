// How big a light run is, for the slot the line keeps free (test-slots.js): a run naming fewer than
// `smallRun` spec files (test-lanes.json, default 5) is small and may take that slot; a run naming
// that many, or any directory or glob (how many specs it holds is unknown), is big and may not.
import fs from 'node:fs';
import path from 'node:path';
import { loadLaneManifest } from './test-lanes.js';

export const DEFAULT_SMALL_RUN = 5;
const GLOB_CHARS = /[*?[{]/;

export const smallRunLimit = (cwd) => loadLaneManifest(cwd)?.smallRun ?? DEFAULT_SMALL_RUN;

const isGroupTarget = (cwd, target) => {
  const isDirectory = fs.statSync(path.resolve(cwd, target), { throwIfNoEntry: false })?.isDirectory();
  return GLOB_CHARS.test(target) || Boolean(isDirectory);
};

// targets: the runner targets as planned (relative to cwd). limit: smallRunLimit(cwd).
export const isBigRun = ({ cwd, targets = [], limit = smallRunLimit(cwd) }) => {
  const hasGroup = targets.some((target) => isGroupTarget(cwd, target));
  return hasGroup || targets.length >= limit;
};
