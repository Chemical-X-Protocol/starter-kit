/**
 * Spec fixture for K1b (#6765): runs `runTeamCli(args, true, root)` the way the CLI does and reports
 * what a script would see: the exit code, what went to stderr and stdout, and the value returned.
 */
import { runTeamCli } from './team-commands.js';

export const runCliCaptured = (root, args) => {
  const savedExitCode = process.exitCode;
  const realErr = process.stderr.write;
  const realOut = process.stdout.write;
  const err = [];
  const out = [];
  process.exitCode = undefined;
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  try {
    const result = runTeamCli(args, true, root);
    return { exitCode: process.exitCode ?? 0, err: err.join(''), out: out.join(''), result };
  } finally {
    process.stderr.write = realErr;
    process.stdout.write = realOut;
    process.exitCode = savedExitCode;
  }
};
