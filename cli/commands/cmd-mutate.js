/**
 * Chemical X Protocol: `chemx mutate <file> --apply <change> --then "<command>" [--keep]` (#6762, K17).
 * Changes the file temporarily, runs the command against it under `chemx run` semantics (cmd-run.js:
 * your terminal, your leases renewed), and always puts the original back. For mutation checks: does a
 * spec fail when this line is wrong? It replaces `cp file file.bak; sed -i ...; <test>; cp -i file.bak file`,
 * whose last step silently did nothing under an aliased interactive cp.
 *
 * - The change: --apply is a unified-diff file or a sed substitution (cli/mutate-edit.js), repeatable.
 *   A change that leaves the file as it was is refused, because a check that mutates nothing proves nothing.
 * - Safety: the original bytes are copied to .chemx/scratch/<handle>/mutate/ first (deleted after a
 *   verified restore unless --keep), a file another handle has leased is refused, binary files are
 *   refused, and the restore (bytes, then the modification time) is read back and compared.
 * - Exit: the command's own code; 125 when chemx could not go on (bad input, a refused file, a restore
 *   that did not verify: the copy is kept and named). A chemx killed with SIGKILL cannot restore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveAgentIdentity } from '../team/agent-identity.js';
import { assertWriteLockClear } from '../team/write-lock-guard.js';
import { ensureScratchDir } from '../scratch-dir.js';
import { applySed, applyUnifiedDiff, isSedExpression } from '../mutate-edit.js';
import { runLeasedCommand } from './cmd-run.js';

const EXIT_STOPPED = 125;
const USAGE = 'usage: chemx mutate <file> --apply <patch-file|s/old/new/[g]> [--apply ...] --then "<command>" [--keep] [--as=@handle]\n';
const SETTERS = {
  '--apply': (parsed, value) => parsed.applies.push(value),
  '--then': (parsed, value) => { parsed.then = value; },
  '--as': (parsed, value) => { parsed.as = value; }
};

const splitFlag = (word) => {
  const isValued = word.startsWith('--') && word.includes('=');
  return isValued ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
};

const checkParsed = (parsed, files) => {
  const [file] = files;
  const lacksFile = file === undefined;
  const hasExtraFile = files.length > 1;
  const lacksApply = parsed.applies.length === 0;
  const lacksThen = parsed.then === undefined || parsed.then.trim() === '';
  if (lacksFile) return 'needs a file to change';
  if (hasExtraFile) return 'one file at a time';
  if (lacksApply) return 'needs at least one --apply <patch-file|s/old/new/>';
  return lacksThen ? 'needs --then "<command>"' : null;
};

// Reads the flag at words[at]; returns the index of the last word it used, or an error.
const readFlag = (parsed, words, at) => {
  const [name, inline] = splitFlag(words[at]);
  const isKeep = name === '--keep';
  if (isKeep) parsed.keep = true;
  const setter = Object.hasOwn(SETTERS, name) ? SETTERS[name] : null;
  if (!setter) return { used: at };
  const takesNext = inline === undefined;
  const value = takesNext ? words[at + 1] : inline;
  const isMissingValue = value === undefined;
  if (isMissingValue) return { error: `${name} needs a value` };
  setter(parsed, value);
  return { used: takesNext ? at + 1 : at };
};

/** @returns {{ file: string|undefined, applies: string[], then: string|undefined, keep: boolean, as: string|undefined, error: string|null }} */
export const parseMutateArgs = (args = []) => {
  const words = args.map(String);
  const parsed = { file: undefined, applies: [], then: undefined, keep: false, as: undefined, error: null };
  const files = [];
  for (let at = 0; at < words.length; at += 1) {
    const isFlag = words[at].startsWith('--');
    if (!isFlag) files.push(words[at]);
    if (!isFlag) continue;
    const read = readFlag(parsed, words, at);
    if (read.error) return { ...parsed, error: read.error };
    at = read.used;
  }
  parsed.file = files[0];
  const error = checkParsed(parsed, files);
  return { ...parsed, error };
};

const stop = (message) => Object.assign(new Error(message), { isStop: true });

const isFile = (target) => fs.existsSync(target) && fs.statSync(target).isFile();

// One --apply on the text: a patch file that exists, else a sed substitution.
const applyOne = (text, change, cwd) => {
  const patchFile = path.resolve(cwd, change);
  if (isFile(patchFile)) return applyUnifiedDiff(text, fs.readFileSync(patchFile, 'utf8'));
  const isSed = isSedExpression(change);
  if (!isSed) throw stop(`--apply "${change}" is neither a file nor a sed substitution`);
  return applySed(text, change);
};

// Reads the file and builds the mutated text; throws a stop for anything that makes a mutation pointless or unsafe.
const prepare = (file, shown, applies, cwd) => {
  const isReadable = isFile(file);
  if (!isReadable) throw stop(`cannot mutate ${shown}: it is not a readable file`);
  const original = fs.readFileSync(file);
  const stat = fs.statSync(file);
  const isBinary = original.includes(0);
  if (isBinary) throw stop(`${shown} looks binary; mutate changes text files only`);
  const originalText = original.toString('utf8');
  let text = originalText;
  try {
    for (const change of applies) text = applyOne(text, change, cwd);
  } catch (error) {
    throw error.isStop ? error : stop(error.message);
  }
  const isUnchanged = text === originalText;
  if (isUnchanged) throw stop(`--apply did not change ${shown}: a mutation that changes nothing proves nothing`);
  return { original, stat, text };
};

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

const saveCopy = (cwd, handle, file, original) => {
  const { dir } = ensureScratchDir(cwd, handle);
  const copyDir = path.join(dir, 'mutate');
  fs.mkdirSync(copyDir, { recursive: true });
  const copy = path.join(copyDir, `${path.basename(file)}.${stamp()}-${process.pid}.orig`);
  fs.writeFileSync(copy, original);
  return copy;
};

// Puts the original back and reads it back; returns null when verified, else the reason.
const restore = (file, snapshot) => {
  try {
    fs.writeFileSync(file, snapshot.original);
    fs.utimesSync(file, snapshot.stat.atime, snapshot.stat.mtime);
    const isIdentical = Buffer.compare(fs.readFileSync(file), snapshot.original) === 0;
    return isIdentical ? null : 'the file read back differently after the restore';
  } catch (error) {
    return error.message;
  }
};

const plural = (count) => (count === 1 ? '1 edit' : `${count} edits`);

const runCommandSafely = async (command, handle, cwd, env, err) => {
  const args = handle ? [`--as=${handle}`, '--', command] : ['--', command];
  try {
    return { code: await runLeasedCommand(args, { cwd, env, err }) };
  } catch (error) {
    return { error };
  }
};

/**
 * @param {string[]} args The words after `mutate`.
 * @param {{ cwd?: string, env?: object, out?: (text: string) => void, err?: (text: string) => void }} [options]
 * @returns {Promise<number>} The command's exit code, or 125.
 */
export const runMutateCommand = async (args, options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const out = options.out ?? ((text) => process.stdout.write(text));
  const err = options.err ?? ((text) => process.stderr.write(text));
  const parsed = parseMutateArgs(args);
  if (parsed.error) {
    err(`chemx mutate: ${parsed.error}\n${USAGE}`);
    return EXIT_STOPPED;
  }
  const identity = resolveAgentIdentity(parsed.as, env);
  const handle = identity.source === 'process' ? null : identity.id;
  const file = path.resolve(cwd, parsed.file);
  const shown = path.relative(cwd, file) || parsed.file;
  let snapshot;
  let copy;
  try {
    snapshot = prepare(file, shown, parsed.applies, cwd);
    assertWriteLockClear(file, cwd, identity.id);
    copy = saveCopy(cwd, handle, file, snapshot.original);
    fs.writeFileSync(file, snapshot.text);
  } catch (error) {
    err(`chemx mutate: ${error.message}\n`);
    return EXIT_STOPPED;
  }
  out(`mutate: ${shown} changed by ${plural(parsed.applies.length)}; original copied to ${copy}\n`);
  const outcome = await runCommandSafely(parsed.then, handle, cwd, env, err);
  const failure = restore(file, snapshot);
  if (failure) {
    err(`mutate: RESTORE FAILED for ${shown}: ${failure}. The original is at ${copy}; put it back with: cat '${copy}' > '${file}'\n`);
    return EXIT_STOPPED;
  }
  if (!parsed.keep) fs.rmSync(copy, { force: true });
  if (outcome.error) {
    err(`mutate: the command could not be run (${outcome.error.message}); ${shown} restored\n`);
    return EXIT_STOPPED;
  }
  out(`mutate: command exited ${outcome.code}; ${shown} restored byte for byte${parsed.keep ? `; copy kept at ${copy}` : ''}\n`);
  return outcome.code;
};
