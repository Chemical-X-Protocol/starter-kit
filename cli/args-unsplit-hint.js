/**
 * The zsh unsplit-argument hint (#6773). zsh does not word-split an unquoted $var, so `chemx commit $files`
 * receives ONE argument, "a.js b.js", and every command answered with a message that blamed the files
 * (not tracked, File not found, matched nothing). One shared check lets commit, check and test say the
 * real cause: an argument that has whitespace between words and is not a path on disk.
 */
import fs from 'node:fs';
import path from 'node:path';

export const UNSPLIT_HINT = 'one argument contains spaces: did a zsh variable not split? use an array or ${=var}';

const hasInnerSpace = (arg) => /\S\s+\S/.test(String(arg));

const diskLookup = (cwd) => (arg) => fs.existsSync(path.resolve(cwd, arg));

/**
 * @param {string[]} args Paths or specs a command expected as separate arguments.
 * @param {{ cwd?: string, exists?: (arg: string) => boolean }} [options] `exists` decides what is on disk (default: relative to `cwd`).
 * @returns {string|null} The first argument that has spaces between words and is not a path on disk.
 */
export const findUnsplitArgument = (args, { cwd = process.cwd(), exists = diskLookup(cwd) } = {}) => {
  const candidates = (args ?? []).filter(hasInnerSpace);
  return candidates.find((arg) => !exists(arg)) ?? null;
};

/** @returns {string} UNSPLIT_HINT when an argument looks unsplit, else ''. */
export const unsplitHint = (args, options = {}) => (findUnsplitArgument(args, options) === null ? '' : UNSPLIT_HINT);

/** @returns {string} `message` with the hint in parentheses when an argument looks unsplit. */
export const withUnsplitHint = (message, args, options = {}) => {
  const hint = unsplitHint(args, options);
  return hint ? `${message} (${hint})` : message;
};
