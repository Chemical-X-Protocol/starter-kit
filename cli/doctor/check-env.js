// Doctor checks for the runtime: node version, every chemx bin on PATH (which kit, which version) and, for a
// pnpm project, whether jest can find the bare modules its config names without NODE_PATH.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { locateKit, realPathOrSelf } from './kit-locate.js';
import { collectJestDeps, findHoisted } from './jest-deps.js';

export const MIN_NODE_MAJOR = 20;
const BIN_NAMES = ['chemx', 'cx', 'cmx', 'chem-x', 'chemical-x'];

export const checkNodeVersion = (version = process.versions.node) => {
  const major = Number(version.split('.')[0]);
  const isSupported = major >= MIN_NODE_MAJOR;
  return {
    id: 'node',
    status: isSupported ? STATUS.PASS : STATUS.FAIL,
    summary: `node ${version}${isSupported ? '' : ` (chemx needs >= ${MIN_NODE_MAJOR}; node:sqlite needs >= 22.5)`}`,
  };
};

export const findOnPath = (name, envPath = process.env.PATH ?? '') => {
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    const isExecutable = fs.existsSync(candidate);
    if (isExecutable) return candidate;
  }
  return null;
};

export const checkBins = ({ cliVersion, envPath = process.env.PATH ?? '' }) => {
  const bins = BIN_NAMES.map((name) => {
    const found = findOnPath(name, envPath);
    const kit = found ? locateKit(found) : null;
    return { name, path: found, target: found ? realPathOrSelf(found) : null, version: kit?.version ?? null, kitRoot: kit?.root ?? null };
  });
  const present = bins.filter((bin) => bin.path);
  const hasChemx = present.some((bin) => bin.name === 'chemx');
  const skewed = present.filter((bin) => bin.version && bin.version !== cliVersion);
  const status = !hasChemx || skewed.length > 0 ? STATUS.FAIL : STATUS.PASS;
  const listing = present.map((bin) => `${bin.name}=${bin.version ?? '?'}`).join(' ') || 'none';
  const skewNote = skewed.length > 0 ? `; differs from this CLI (${cliVersion})` : '';
  return { id: 'bins', status, summary: `on PATH: ${listing}${hasChemx ? '' : '; chemx not on PATH'}${skewNote}`, details: bins };
};

const MAX_NAMES_SHOWN = 3;

const isOnNodePath = (nodePath, dir) => nodePath.split(path.delimiter).filter(Boolean).some((entry) => realPathOrSelf(path.resolve(entry)) === realPathOrSelf(dir));

// pnpm keeps packages nobody depends on directly only under node_modules/.pnpm/node_modules. jest resolves
// a bare snapshotSerializers or transform name from the rootDir, so it finds those only through NODE_PATH.
export const checkJestLayout = ({ projectRoot, nodePath = process.env.NODE_PATH ?? '' }) => {
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm', 'node_modules');
  const isPnpm = fs.existsSync(pnpmDir);
  const deps = isPnpm ? collectJestDeps(projectRoot) : [];
  const hasNothingToCheck = deps.length === 0;
  if (hasNothingToCheck) return null;
  const pnpmOnly = deps.filter((dep) => !findHoisted(projectRoot, dep.name) && fs.existsSync(path.join(pnpmDir, dep.name)));
  const isCovered = isOnNodePath(nodePath, pnpmDir);
  const names = pnpmOnly.slice(0, MAX_NAMES_SHOWN).map((dep) => `${dep.name} (${dep.from})`).join(', ');
  const moreNote = pnpmOnly.length > MAX_NAMES_SHOWN ? `, +${pnpmOnly.length - MAX_NAMES_SHOWN} more` : '';
  const verb = pnpmOnly.length === 1 ? 'resolves' : 'resolve';
  const isAllHoisted = pnpmOnly.length === 0;
  if (isAllHoisted) return { id: 'jest-deps', status: STATUS.PASS, summary: `jest config deps resolve from node_modules (${deps.length} checked)` };
  if (isCovered) return { id: 'jest-deps', status: STATUS.PASS, summary: `${names}${moreNote} ${verb} only under node_modules/.pnpm/node_modules; NODE_PATH covers it`, details: pnpmOnly };
  const summary = `${names}${moreNote} ${verb} only under node_modules/.pnpm/node_modules; chemx test puts it on NODE_PATH, a raw jest run needs NODE_PATH=${pnpmDir}`;
  return { id: 'jest-deps', status: STATUS.INCONCLUSIVE, summary, fixable: false, details: pnpmOnly };
};
