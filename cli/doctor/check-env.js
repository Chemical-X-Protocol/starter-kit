// Doctor checks for the runtime: node version and every chemx bin on PATH (which kit, which version).

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { locateKit, realPathOrSelf } from './kit-locate.js';

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
