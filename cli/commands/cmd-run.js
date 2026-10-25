/**
 * Chemical X Protocol: `chemx run -- <command...>` (#6758).
 * Runs a command with the caller's own stdin, stdout and stderr and exits with its code, and while it
 * runs renews the caller's file leases every minute. A lease lasts 5 minutes from the holder's last
 * chemx call, and a plugin's 90 s test runner or a long script is not a chemx call; wrapped in `run`
 * it is, for as long as it lives. `chemx run -- node tests/run-tests.mjs` is the intended use.
 *
 * - The command is the words after `--` (or after the leading --as), spawned directly, no shell. One
 *   quoted word that contains whitespace is a whole shell command, as for `chemx build`.
 * - Exit code: the child's; a child killed by a signal is 128 + the signal number; 127 = could not be
 *   found, 126 = could not be run, 125 = chemx run itself was misused (like timeout(1)).
 * - SIGINT, SIGTERM and SIGHUP sent to chemx go to the child, which therefore never outlives it.
 * - Leases: the same renewal as every chemx command (lease-activity.js): the boards from the directory
 *   upward, the boards of the caller's in_progress claims (a worktree is outside the board), and the
 *   activity window. Without a handle (--as, CHEMX_AGENT_ID) nothing can be renewed; one stderr line says so.
 * Limit: only the caller's leases are extended, and not past the contention cap while someone waits for
 * the file (lease-cap.js); the wrapper cannot make a lease outlive a queue.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { activityHolder, renewHolderLeases, startLeaseKeepalive } from '../team/lease-activity.js';

export const RUN_RENEW_MS = 60 * 1000;
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const EXIT_MISUSE = 125;
const EXIT_NOT_RUNNABLE = 126;
const EXIT_NOT_FOUND = 127;
const USAGE = 'usage: chemx run [--as=@handle] -- <command> [args...]';

const AS_PREFIX = '--as=';

const failedParse = (as, error) => ({ as, words: [], error });

/**
 * @returns {{ as: string|undefined, words: string[], error: string|null }}
 *   Leading `--as=@x` / `--as @x`, then `--` (optional) and the command words, which are never read as chemx flags.
 */
export const parseRunArgs = (args = []) => {
  const words = args.map(String);
  let as;
  let at = 0;
  for (; at < words.length; at += 1) {
    const word = words[at];
    const isSeparator = word === '--';
    const isCommandStart = !word.startsWith('-');
    const isOptionsEnd = isSeparator || isCommandStart;
    if (isOptionsEnd) break;
    const isInline = word.startsWith(AS_PREFIX);
    const isSpaced = word === '--as';
    if (isInline) as = word.slice(AS_PREFIX.length);
    if (isSpaced) as = words[at + 1];
    if (isSpaced) at += 1;
    const isMissingHandle = isSpaced && as === undefined;
    if (isMissingHandle) return failedParse(as, '--as needs a handle (--as=@you)');
    const isKnownFlag = isInline || isSpaced;
    if (!isKnownFlag) return failedParse(as, `unknown flag ${word}; put the command after --`);
  }
  const hasSeparator = words[at] === '--';
  const command = words.slice(hasSeparator ? at + 1 : at);
  const hasCommand = command.length > 0;
  return { as, words: command, error: hasCommand ? null : 'no command' };
};

const isShellString = (words) => words.length === 1 && /\s/.test(words[0]);

const exitCodeOf = (code, signal) => {
  const isExit = typeof code === 'number';
  return isExit ? code : 128 + (os.constants.signals[signal] ?? 0);
};

const startFailureCode = (error) => (error.code === 'ENOENT' ? EXIT_NOT_FOUND : EXIT_NOT_RUNNABLE);

const spawnChild = (words, cwd, env) => {
  const useShell = isShellString(words);
  const [file, ...rest] = words;
  return spawn(file, useShell ? [] : rest, { cwd, env, stdio: 'inherit', shell: useShell });
};

/**
 * Runs the child to the end and settles with its exit code. Forwards termination signals to it.
 * @returns {Promise<{ code: number, error: Error|null }>}
 */
const superviseChild = (child) => new Promise((resolve) => {
  const forward = (signal) => child.kill(signal);
  const handlers = FORWARDED_SIGNALS.map((signal) => [signal, () => forward(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  let isSettled = false;
  const settle = (result) => {
    if (isSettled) return;
    isSettled = true;
    for (const [signal, handler] of handlers) process.off(signal, handler);
    resolve(result);
  };
  child.once('error', (error) => settle({ code: startFailureCode(error), error }));
  child.once('close', (code, signal) => settle({ code: exitCodeOf(code, signal), error: null }));
});

const NO_HANDLE_NOTE = 'chemx run: no agent handle (--as=@you or CHEMX_AGENT_ID), so no leases are renewed while this runs.\n';

/**
 * @param {string[]} args The words after `run`.
 * @param {{ cwd?: string, env?: object, ttlMs?: number, intervalMs?: number, err?: (text: string) => void }} [options]
 *   ttlMs and intervalMs exist for specs; the CLI uses the 5-minute TTL and RUN_RENEW_MS.
 * @returns {Promise<number>} The process exit code.
 */
export const runLeasedCommand = async (args, options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const write = options.err ?? ((text) => process.stderr.write(text));
  const parsed = parseRunArgs(args);
  if (parsed.error) {
    write(`chemx run: ${parsed.error}\n${USAGE}\n`);
    return EXIT_MISUSE;
  }
  const holder = activityHolder(parsed.as, env);
  if (!holder) write(NO_HANDLE_NOTE);
  const lease = { env, ttlMs: options.ttlMs };
  renewHolderLeases(cwd, holder ?? undefined, lease);
  const stopKeepalive = startLeaseKeepalive(cwd, holder ?? undefined, { ...lease, intervalMs: options.intervalMs ?? RUN_RENEW_MS });
  const { code, error } = await superviseChild(spawnChild(parsed.words, cwd, env));
  stopKeepalive();
  renewHolderLeases(cwd, holder ?? undefined, lease);
  if (error) write(`chemx run: cannot start ${parsed.words[0]}: ${error.code ?? error.message}\n`);
  return code;
};
