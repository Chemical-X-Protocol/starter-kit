import fs from 'node:fs';
import path from 'node:path';
import { matchTypeScriptError } from './build/parser-matchers.js';
import { resolvePackageManager } from './build/detector.js';
import { joinCommandWords } from './cli-args.js';

export { detectTypecheckCommand } from './typecheck-command.js';
export { detectTestCommand } from './test-command.js';
export { parseTestOutput } from './test-output.js';

// The command after `--` (verify-lint), joined the same way as test/typecheck/build commands.
export const parseCommandFromArgs = (args = []) => {
  const dashDashIndex = args.indexOf('--');
  const hasSeparator = dashDashIndex !== -1;
  const command = hasSeparator ? joinCommandWords(args.slice(dashDashIndex + 1)) : '';
  return command.length > 0 ? command : null;
};

export const parseTypecheckOutput = (stdout = '', stderr = '') => {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  const errors = [];
  const seen = new Set();

  for (const line of lines) {
    const match = matchTypeScriptError(stripAnsi(line).trim());
    const key = match ? `${match.file}:${match.line}:${match.column}:${match.code}` : null;
    const isNewDiagnostic = key !== null && !seen.has(key);
    if (!isNewDiagnostic) continue;
    seen.add(key);
    errors.push(match);
  }

  return errors;
};

export const stripAnsi = (str = '') => String(str).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

export const checkNodeModules = (cwd) => {
  const hasNodeModules = fs.existsSync(path.join(cwd, 'node_modules'));
  if (hasNodeModules) return null;
  const pm = resolvePackageManager(cwd);
  return {
    missing: true,
    pm,
    msg: (action) => `Missing node_modules. Please run '${pm} install' before ${action}.`
  };
};
