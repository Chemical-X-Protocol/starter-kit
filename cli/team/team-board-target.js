/**
 * Chemical X Protocol: which board a team command reads (K6, #6751).
 * By default a team command uses the board of the directory it runs in. `--board=<dir>` (or
 * `--board <dir>`) and a task written `<root>#<id>` (`chemx team task show ../app#1553`) address another
 * board from any cwd, so the same number can be asked of two boards without a `cd`. The board of that
 * directory must already have a team db (resolveHandleBoard); nothing is created. The command then runs
 * as if started in that directory: its cwd becomes the directory, so targets resolve against it.
 */
import os from 'node:os';
import path from 'node:path';
import { resolveHandleBoard } from './board-resolve.js';
import { splitBoardRef } from './task-ref.js';
import { ID_ARG_ACTIONS } from './team-commands-repo.js';

const toAbsolute = (cwd, value) => {
  const isHome = value === '~' || value.startsWith('~/');
  return path.resolve(cwd, isHome ? path.join(os.homedir(), value.slice(1)) : value);
};

// `team task <action> <root>#<id>`: only the id slot of an id action reads a board reference; a title or comment is text.
const typedBoardRef = (subCommand, positionals) => {
  const takesTaskId = subCommand === 'task' && ID_ARG_ACTIONS.has(positionals[0]);
  if (!takesTaskId) return null;
  const split = splitBoardRef(positionals[1]);
  return split.board === null ? null : split;
};

const withRef = (positionals, ref) => positionals.map((word, at) => (at === 1 ? ref : word));

/**
 * @param {{ subCommand: string, flags: { board?: string }, positionals: string[], cwd: string, env?: object }} request
 *   positionals: the words after the team subcommand (`task show 12` is ['show', '12'])
 * @returns {{ cwd: string, positionals: string[], board: string|null, error: string|null }}
 *   cwd: where the command runs (the named directory, else the caller's); board: the board root when one was named
 */
export const resolveBoardTarget = ({ subCommand, flags, positionals, cwd, env = process.env }) => {
  const unchanged = { cwd, positionals, board: null, error: null };
  const typed = typedBoardRef(subCommand, positionals);
  const flagged = flags.board;
  const hasEmptyFlag = flagged === '';
  if (hasEmptyFlag) return { ...unchanged, error: '--board needs a directory: write --board=<dir> or --board <dir>.' };
  const named = [flagged, typed?.board].filter((value) => typeof value === 'string');
  const namesBoard = named.length > 0;
  if (!namesBoard) return unchanged;
  const dirs = named.map((value) => toAbsolute(cwd, value));
  const namesTwoBoards = new Set(dirs).size > 1;
  if (namesTwoBoards) return { ...unchanged, error: `one board per command: ${named.join(' and ')} name different boards.` };
  const resolved = resolveHandleBoard(cwd, { board: dirs[0], env });
  const hasError = Boolean(resolved.error);
  if (hasError) return { ...unchanged, error: resolved.error };
  return { cwd: dirs[0], positionals: typed ? withRef(positionals, typed.ref) : positionals, board: resolved.root, error: null };
};
