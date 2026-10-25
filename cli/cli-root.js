/**
 * Chemical X Protocol: one project root for every command (#6751, K6).
 * `--root=<dir>` (also `--root <dir>` and `--project-root`) and CHEMX_PROJECT_ROOT start any command in
 * another project, from any cwd, the way `cd <dir> && chemx ...` would: the flag is removed from the
 * arguments, then the process changes directory, so relative paths, git, the code index and the board
 * all resolve against that root. Order: the flag, then CHEMX_PROJECT_ROOT, then (read and q only) an
 * absolute path that lies inside another chemx project. A bad flag is an error; a bad env value is a
 * note and the cwd stays.
 * Not covered: the MCP server (it has its own root rules), help and version, and the words after
 * `--` or after the first word of build/run/wrap, which belong to the wrapped tool.
 * Dependencies are node: built-ins and project-markers.js only, so the boot shim can load it for the
 * early conflict commands.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isForbiddenRoot } from './project-markers.js';

export const ROOT_ENV = 'CHEMX_PROJECT_ROOT';
const ROOT_FLAGS = new Set(['--root', '--project-root']);
const NO_FLAGS = new Set();

// The server picks its root per call; help and version run nothing in a project.
const OWN_ROOT_COMMANDS = new Set(['mcp', 'mcp-server', 'server', 'help', '--help', '-h', 'version', '--version', '-v']);
// These read --root themselves (as the project to install into, report on or write to), so they keep it, made absolute.
const KEEP_FLAG_COMMANDS = new Set(['doctor', 'install-hooks', 'friction']);
// After their first word the rest is the wrapped command (parseCliArgs positionalCommand).
const COMMAND_TAIL_COMMANDS = new Set(['build', 'run', 'wrap']);
const SEARCH_COMMANDS = new Set(['search', 'q', 'query', 'find']);
const READ_COMMANDS = new Set(['read', 'view', 'r']);
const PATTERN_FLAGS = new Set(['-g', '--literal']);
const QUIET_FLAGS = new Set(['--bare', '-b', '--json', '--raw-json', '--columnar', '-l', '--lines']);
const ROOT_FLAG_PATTERN = /^--(project-)?root(=|$)/;

/** The schema row shown wherever a command documents its flags. */
export const ROOT_FLAG_ROW = Object.freeze({ flag: '--root=<dir>', desc: 'Run in that project root, from any cwd (also CHEMX_PROJECT_ROOT)' });

const isDirectory = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false; // chemx-allow: best-effort a path that cannot be read is not a directory
  }
};

const expandHome = (value) => (value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value);
const toAbsolute = (cwd, value) => path.resolve(cwd, expandHome(value));

/** True when any word looks like a root flag, so a command without one skips every other step. */
export const mentionsRootFlag = (rawArgs = []) => rawArgs.some((arg) => ROOT_FLAG_PATTERN.test(String(arg)));

const splitFlag = (token) => {
  const eq = token.indexOf('=');
  const hasInline = token.startsWith('--') && eq > 0;
  return hasInline ? [token.slice(0, eq), token.slice(eq + 1)] : [token, null];
};

// `--root=<dir> done, see the ticket` as a comment or title is text that starts with the flag's spelling: not a directory name.
const isFreeText = (value, cwd) => /\s/.test(value) && !isDirectory(toAbsolute(cwd, value));

/**
 * Removes the root flag from the arguments.
 * @param {string[]} rawArgs the words after `chemx`
 * @param {{ cwd?: string, valueFlagsOf?: (command: string) => Set<string> }} [options]
 *   valueFlagsOf: the long flags of a command that take the next word as a value, so that word is never read as a root flag
 * @returns {{ args: string[], root: string|null, flag: string|null, command: string|null, error: string|null }}
 *   command: the first word that is not a flag; root: the last value given
 */
export const extractRootFlag = (rawArgs = [], options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const valueFlagsOf = options.valueFlagsOf ?? (() => NO_FLAGS);
  const words = rawArgs.map(String);
  const kept = [];
  const result = { args: kept, root: null, flag: null, command: null, error: null };
  for (let at = 0; at < words.length; at += 1) {
    const token = words[at];
    const endsOptions = token === '--';
    if (endsOptions) {
      kept.push(...words.slice(at));
      break;
    }
    const [name, inline] = splitFlag(token);
    const isRootFlag = ROOT_FLAGS.has(name) && !(inline !== null && isFreeText(inline, cwd));
    if (isRootFlag) {
      const next = words[at + 1];
      const hasSpacedValue = inline === null && next !== undefined && !next.startsWith('-');
      const value = inline ?? (hasSpacedValue ? next : '');
      const isMissingDirectory = value === '';
      if (isMissingDirectory) return { ...result, error: `${name} needs a directory: write ${name}=<dir> or ${name} <dir>.` };
      if (hasSpacedValue) at += 1;
      result.root = value;
      result.flag = name;
      continue;
    }
    const isWord = !token.startsWith('-');
    const isCommandWord = isWord && result.command === null;
    if (isCommandWord) result.command = token;
    const startsWrappedCommand = isWord && result.command !== token && COMMAND_TAIL_COMMANDS.has(result.command);
    if (startsWrappedCommand) {
      kept.push(...words.slice(at));
      break;
    }
    const isPatternFlag = SEARCH_COMMANDS.has(result.command) && PATTERN_FLAGS.has(token);
    const isValueFlag = inline === null && token.startsWith('--') && result.command !== null && valueFlagsOf(result.command).has(name);
    const consumesNext = (isPatternFlag || isValueFlag) && words[at + 1] !== undefined && words[at + 1] !== '--';
    kept.push(token);
    if (consumesNext) {
      kept.push(words[at + 1]);
      at += 1;
    }
  }
  return result;
};

// A chemx project: a directory chemx was set up in (.chemxrc) or has already indexed (.chemx/index.db).
const isChemxProject = (dir) => fs.existsSync(path.join(dir, '.chemxrc')) || fs.existsSync(path.join(dir, '.chemx', 'index.db'));

const chemxProjectOf = (start) => {
  const home = os.homedir();
  for (let dir = start; ; dir = path.dirname(dir)) {
    const isBoundary = isForbiddenRoot(dir) || dir === home;
    if (isBoundary) return null;
    if (isChemxProject(dir)) return dir;
  }
};

// The directory a path argument lives in: the path itself when it is one, else its parent (a file, or a file:N-M slice).
const startOf = (abs) => (isDirectory(abs) ? abs : path.dirname(abs));

const absolutePathWords = (args) => args
  .map((word) => String(word).replace(/^--dir=/, '').replace(/:\d+(-\d+)?$/, ''))
  .filter((word) => path.isAbsolute(word) && fs.existsSync(word));

/**
 * The chemx project that owns an absolute path argument of read or q, when that is not the cwd's own
 * project. Relative paths, other commands, and paths no chemx project owns return null: the usual
 * "outside the project root" refusal still applies to them.
 */
export const inferPathRoot = (command, args = [], cwd = process.cwd()) => {
  const readsPaths = READ_COMMANDS.has(command) || SEARCH_COMMANDS.has(command);
  if (!readsPaths) return null;
  const home = chemxProjectOf(cwd);
  for (const abs of absolutePathWords(args)) {
    const owner = chemxProjectOf(startOf(abs));
    const isOtherProject = owner !== null && owner !== home;
    if (isOtherProject) return owner;
  }
  return null;
};

const chooseRoot = ({ extracted, args, env, cwd }) => {
  const command = extracted.command;
  const hasFlagRoot = extracted.root !== null;
  if (hasFlagRoot) {
    const abs = toAbsolute(cwd, extracted.root);
    return isDirectory(abs) ? { root: abs, source: 'flag' } : { error: `${extracted.flag}=${extracted.root}: ${abs} is not a directory.` };
  }
  const envValue = env[ROOT_ENV];
  const hasEnvRoot = typeof envValue === 'string' && envValue !== '';
  if (hasEnvRoot) {
    const abs = toAbsolute(cwd, envValue);
    return isDirectory(abs) ? { root: abs, source: 'env' } : { note: `! ${ROOT_ENV}=${envValue} is not a directory; using ${cwd}.` };
  }
  const inferred = inferPathRoot(command, args, cwd);
  if (!inferred) return {};
  const isQuiet = args.some((arg) => QUIET_FLAGS.has(String(arg)));
  return { root: inferred, source: 'path', note: isQuiet ? null : `chemx root: ${inferred} (the path is outside ${cwd})` };
};

// doctor, install-hooks and friction parse --root themselves: hand it back as one absolute --root=<dir> after the command.
const keepRootFlag = (args, command, root) => {
  const at = args.indexOf(command);
  return [...args.slice(0, at + 1), `--root=${root}`, ...args.slice(at + 1)];
};

/**
 * Decides the root for one command line, without changing anything.
 * @param {string[]} rawArgs the words after `chemx`
 * @param {{ cwd?: string, env?: object, valueFlagsOf?: (command: string) => Set<string> }} [options]
 * @returns {{ args: string[], root: string|null, source: 'flag'|'env'|'path'|null, command: string|null, note: string|null, error: string|null }}
 *   args: the words without the root flag; root: the directory to run in (null: stay in the cwd); note: one line for stderr
 */
export const resolveCliRoot = (rawArgs = [], options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const extracted = extractRootFlag(rawArgs, { cwd, valueFlagsOf: options.valueFlagsOf });
  const base = { args: extracted.args, root: null, source: null, command: extracted.command, note: null, error: null };
  if (extracted.error) return { ...base, args: rawArgs.map(String), error: extracted.error };
  const ownsRoot = extracted.command === null || OWN_ROOT_COMMANDS.has(extracted.command);
  if (ownsRoot) return base;
  const chosen = chooseRoot({ extracted, args: extracted.args, env, cwd });
  if (chosen.error) return { ...base, args: rawArgs.map(String), error: chosen.error };
  const keepsFlag = KEEP_FLAG_COMMANDS.has(extracted.command) && chosen.source === 'flag';
  const args = keepsFlag ? keepRootFlag(extracted.args, extracted.command, chosen.root) : extracted.args;
  return { ...base, args, root: chosen.root ?? null, source: chosen.source ?? null, note: chosen.note ?? null };
};

const sameDirectory = (a, b) => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b); // chemx-allow: best-effort a path that vanished compares by its text
  }
};

/**
 * Resolves the root and moves the process into it. An explicit root also replaces CHEMX_PROJECT_ROOT
 * in the environment, so the code index (which prefers that variable) follows the same directory.
 * @param {{ chdir?: (dir: string) => void }} [options] plus the options of resolveCliRoot
 */
export const applyCliRoot = (rawArgs = [], options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const chdir = options.chdir ?? ((dir) => process.chdir(dir));
  const resolved = resolveCliRoot(rawArgs, { ...options, cwd, env });
  const mustMove = !resolved.error && resolved.root !== null && !sameDirectory(resolved.root, cwd);
  if (mustMove) chdir(resolved.root);
  const replacesEnvRoot = mustMove && resolved.source !== 'env' && Boolean(env[ROOT_ENV]);
  if (replacesEnvRoot) env[ROOT_ENV] = resolved.root;
  return resolved;
};

/**
 * Runs one `chemx do` item in the root named by its own --root, then returns to the directory it started in.
 * @param {string[]} tokens the item's words (command first)
 * @param {(args: string[]) => Promise<unknown>} run called with the words minus the flag
 * @returns {Promise<unknown>} the run's result; throws when the root is unusable or the item was only a flag
 */
export const runInItemRoot = async (tokens, run, options = {}) => {
  const prior = process.cwd();
  const resolved = applyCliRoot(tokens, { ...options, env: { ...process.env } });
  const hasError = Boolean(resolved.error);
  if (hasError) throw new Error(resolved.error);
  const isFlagOnly = resolved.args.length === 0;
  if (isFlagOnly) throw new Error(`${tokens.join(' ')}: a root flag needs a command after it.`);
  try {
    return await run(resolved.args);
  } finally {
    process.chdir(prior);
  }
};
