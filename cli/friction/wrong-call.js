// Record a wrong chemx call (unknown command) as friction. Only projects that already have a .chemx
// directory (or an explicit CHEMX_FRICTION_LOG) are written to, so a typo never creates files elsewhere.

import fs from 'node:fs';
import path from 'node:path';
import { appendFriction } from './friction-log.js';

export const recordWrongCall = (cwd, command, rawArgs, env = process.env) => {
  const hasProjectLog = Boolean(env.CHEMX_FRICTION_LOG) || fs.existsSync(path.join(cwd, '.chemx'));
  if (!hasProjectLog) return null;
  return appendFriction(cwd, { kind: 'wrong-call', rule: 'unknown-command', command: `chemx ${rawArgs.join(' ')}`, note: `unknown command "${command}"` }, env);
};
