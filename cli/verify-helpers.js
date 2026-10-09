import fs from 'node:fs';
import path from 'node:path';
import { matchTypeScriptError } from './build/parser-matchers.js';
import { resolvePackageManager } from './build/detector.js';

export { detectTypecheckCommand } from './typecheck-command.js';
export { detectTestCommand } from './test-command.js';
export { parseTestOutput } from './test-output.js';

export const parseCommandFromArgs = (args = []) => {
  const dashDashIndex = args.indexOf('--');
  if (dashDashIndex !== -1) {
    const afterDash = args.slice(dashDashIndex + 1).join(' ').trim();
    if (afterDash.length > 0) return afterDash;
  }
  return null;
};

export const parseTypecheckOutput = (stdout = '', stderr = '') => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  const errors = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = matchTypeScriptError(trimmed);
    if (match) {
      const key = `${match.file}:${match.line}:${match.column}:${match.code}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(match);
      }
    }
  }

  return errors;
};

export const stripAnsi = (str = '') => String(str).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

export const checkNodeModules = (cwd) => {
  const nmPath = path.join(cwd, 'node_modules');
  if (fs.existsSync(nmPath)) return null;
  const pm = resolvePackageManager(cwd);
  return {
    missing: true,
    pm,
    msg: (action) => `Missing node_modules. Please run '${pm} install' before ${action}.`
  };
};
