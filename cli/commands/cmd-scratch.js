/**
 * Chemical X Protocol: `chemx scratch [name]` (#6762, K17).
 * Prints the caller's own scratch directory, `<project>/.chemx/scratch/<handle>/`, creating it when it
 * is missing; with a name, the path of that file inside it (its folders are made, the file is not).
 * The handle is --as, then CHEMX_AGENT_ID, then the session handle; with none the directory is
 * `_shared` and one stderr line says it is shared. Directory logic: cli/scratch-dir.js.
 * Exit: 0 printed, 2 misused (two names, a name that leaves the directory), 1 could not create it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveAgentIdentity } from '../team/agent-identity.js';
import { ensureScratchDir, scratchPathFor } from '../scratch-dir.js';

const AS_PREFIX = '--as=';
const EXIT_FAILED = 1;
const EXIT_MISUSE = 2;
const NO_HANDLE_NOTE = 'chemx scratch: no agent handle (--as=@you or CHEMX_AGENT_ID), so this is the _shared directory every unnamed caller also gets; set CHEMX_AGENT_ID for a private one.\n';

/** @returns {{ as: string|undefined, name: string|undefined, error: string|null }} */
export const parseScratchArgs = (args = []) => {
  const words = args.map(String);
  const names = [];
  let as;
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at];
    const isInline = word.startsWith(AS_PREFIX);
    const isSpaced = word === '--as';
    if (isInline) as = word.slice(AS_PREFIX.length);
    if (isSpaced) as = words[at + 1];
    if (isSpaced) at += 1;
    const isMissingHandle = isSpaced && as === undefined;
    if (isMissingHandle) return { as, name: undefined, error: '--as needs a handle (--as=@you)' };
    const isFlag = isInline || isSpaced;
    if (!isFlag) names.push(word);
  }
  const hasTooMany = names.length > 1;
  return { as, name: names[0], error: hasTooMany ? 'one name at most' : null };
};

/**
 * @param {string[]} args The words after `scratch`.
 * @param {{ cwd?: string, env?: object, out?: (text: string) => void, err?: (text: string) => void }} [options]
 * @returns {number} The process exit code.
 */
export const runScratchCommand = (args, options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const out = options.out ?? ((text) => process.stdout.write(text));
  const err = options.err ?? ((text) => process.stderr.write(text));
  const parsed = parseScratchArgs(args);
  if (parsed.error) {
    err(`chemx scratch: ${parsed.error}\nusage: chemx scratch [name] [--as=@handle]\n`);
    return EXIT_MISUSE;
  }
  const identity = resolveAgentIdentity(parsed.as, env);
  const isAnonymous = identity.source === 'process';
  if (isAnonymous) err(NO_HANDLE_NOTE);
  try {
    const { dir, ignoreAdded } = ensureScratchDir(cwd, isAnonymous ? null : identity.id);
    if (ignoreAdded) err('chemx scratch: added .chemx/scratch/ to .gitignore\n');
    const hasName = parsed.name !== undefined;
    const target = hasName ? scratchPathFor(dir, parsed.name) : dir;
    if (hasName) fs.mkdirSync(path.dirname(target), { recursive: true });
    out(`${target}\n`);
    return 0;
  } catch (error) {
    err(`chemx scratch: ${error.message}\n`);
    return error.isUsage ? EXIT_MISUSE : EXIT_FAILED;
  }
};
