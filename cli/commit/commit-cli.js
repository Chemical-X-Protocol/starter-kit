/**
 * Chemical X Protocol: terminal front for `chemx commit` (#2564). Plain text, one line per fact; --json
 * prints the same facts as one object. Refusals and failures go to stderr and set exit code 1.
 */
import { runCommit } from './commit-run.js';

const jsonOf = (result) => ({
  ok: result.ok,
  ...(result.data ?? {}),
  ...(result.ok ? {} : { refusals: result.refusals, message: result.lines })
});

/**
 * @param {string[]} args Everything after `chemx commit`.
 * @returns {Promise<object>} the run result (also printed)
 */
export const runCommitCli = async (args, options = {}) => {
  const result = await runCommit(args, options);
  const stream = result.ok ? process.stdout : process.stderr;
  const text = result.json ? `${JSON.stringify(jsonOf(result), null, 2)}\n` : `${result.lines.join('\n')}\n`;
  const target = result.json ? process.stdout : stream;
  target.write(text);
  process.exitCode = result.exitCode;
  return result;
};
