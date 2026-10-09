/**
 * lattice-payload.js: the structured state behind `chemx tesseract`.
 * Core side of the plan 5.4 seam: `tesseract --json` loads this module, never the HUD.
 */

import fs from 'node:fs';
import { getTesseractState } from './lattice-state.js';
import { DIRECTIVES, JARVIS_OPERATIONS } from './lattice-directives.js';
import { formatAgentJson } from './agent-json.js';

const readKitVersion = () => {
  try {
    const pkgContent = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(pkgContent).version || 'unknown';
  } catch (readError) {
    return `unknown (${readError instanceof Error ? readError.message : String(readError)})`;
  }
};

export const buildLatticePayload = (cwd = process.cwd()) => ({
  protocol: 'Chemical X Tesseract',
  version: readKitVersion(),
  timestamp: new Date().toISOString(),
  philosophy: 'Human-AI Symbiosis Medium & Universal Molecular Program',
  state: getTesseractState(cwd),
  directives: DIRECTIVES,
  jarvisOperations: JARVIS_OPERATIONS
});

export const runLatticeJson = (isCli = false, cwd = process.cwd()) => {
  const payload = buildLatticePayload(cwd);
  if (isCli) process.stdout.write(`${formatAgentJson(payload)}\n`);
  return payload;
};
