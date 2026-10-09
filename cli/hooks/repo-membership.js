// Is a path inside some git repository other than the session's project root? Native file tools
// stay blocked there too (a kit session editing a host-repo file, a sibling checkout). Free regardless:
// the user's ~/.claude tree, node_modules, binary files, and a repo that is just the home directory or /.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInsideDirectory } from './guard-paths.js';

const MAX_LEVELS = 32;

const hasGitEntry = (directory) => fs.existsSync(path.join(directory, '.git'));

// Nearest ancestor directory holding a .git entry, ignoring / and the home directory itself.
export const findRepoRoot = (absolute, home = os.homedir()) => {
  let directory = path.dirname(absolute);
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const isTop = directory === path.dirname(directory) || directory === home;
    if (isTop) return null;
    if (hasGitEntry(directory)) return directory;
    directory = path.dirname(directory);
  }
  return null;
};

export const isInOtherRepo = (absolute, root, home = os.homedir()) => {
  const isInRoot = isInsideDirectory(absolute, root);
  const isUserClaudeTree = isInsideDirectory(absolute, path.join(home, '.claude'));
  const isVendored = absolute.split(path.sep).includes('node_modules');
  const isExempt = isInRoot || isUserClaudeTree || isVendored;
  return !isExempt && findRepoRoot(absolute, home) !== null;
};
