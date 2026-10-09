// Find which chemx kit a path belongs to, and its version: walk up to the nearest package.json that
// declares a chemx bin. Shared by the PATH, MCP launch and running-process checks.

import fs from 'node:fs';
import path from 'node:path';

const KIT_PACKAGES = new Set(['@chemx/starter-kit', '@chem-x/starter-kit', 'chemx', 'create-chemx', '@chemx/create-chemx']);

const readPackage = (dir) => {
  const file = path.join(dir, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null; // no or unreadable package.json at this level: keep walking up
  }
};

const isKitPackage = (pkg) => {
  const hasChemxBin = typeof pkg?.bin === 'object' && pkg.bin !== null && Object.hasOwn(pkg.bin, 'chemx');
  return KIT_PACKAGES.has(pkg?.name) || hasChemxBin;
};

export const realPathOrSelf = (target) => {
  try {
    return fs.realpathSync(target);
  } catch {
    return target; // dangling links are reported by the caller through exists checks
  }
};

export const locateKit = (target) => {
  let dir = path.dirname(realPathOrSelf(target));
  for (let depth = 0; depth < 8; depth += 1) {
    const pkg = readPackage(dir);
    if (isKitPackage(pkg)) return { root: dir, version: pkg.version ?? 'unknown', name: pkg.name };
    const parent = path.dirname(dir);
    const isFilesystemRoot = parent === dir;
    if (isFilesystemRoot) break;
    dir = parent;
  }
  return null;
};
