/**
 * Chemical X Protocol: where a handle's claimed task lives (#6750).
 * Tasks live on boards (<root>/.chemx/index.db) and a directory resolves to exactly one board, but
 * work crosses repos: an agent claims #1553 on the app's board and then commits from a plugin
 * directory whose board is the monorepo's. A claim therefore leaves a small pointer, one JSON file per
 * handle (`<dir>/<handle>.json`: the boards and task ids that handle claimed, newest first), which
 * `chemx commit` reads to find the board again. The pointer is a hint, never the truth: the resolver
 * (board-resolve.js) re-checks the task in the board's own db and ignores a pointer whose task is no
 * longer the handle's in_progress task.
 * The directory is CHEMX_BOARD_CLAIMS_DIR, else $XDG_STATE_HOME/chemx/board-claims, else
 * ~/.local/state/chemx/board-claims. A spec process (node --test) has no default directory, so a spec
 * never writes the real home. Writes go through a temp file and a rename; a failed write loses only
 * the hint, never the claim.
 * A handoff moves the pointer with the task (#6766): `recordBoardClaim` for the new owner and
 * `forgetBoardClaim` for the old one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSpecProcess } from './coordination-root.js';

export const CLAIMS_DIR_ENV = 'CHEMX_BOARD_CLAIMS_DIR';
export const MAX_CLAIMS_PER_HANDLE = 12;
const DIR_MODE = 0o700;

const isAbsoluteValue = (value) => typeof value === 'string' && value.trim() !== '' && path.isAbsolute(value.trim());

const stateHome = (env) => {
  const xdg = env.XDG_STATE_HOME;
  return isAbsoluteValue(xdg) ? xdg.trim() : path.join(env.HOME || os.homedir(), '.local', 'state');
};

/** The directory holding the pointer files, or null when pointers are off (a spec process without the env var). */
export const boardClaimsDir = (env = process.env) => {
  const explicit = env[CLAIMS_DIR_ENV];
  const hasExplicit = explicit !== undefined && explicit !== '';
  if (hasExplicit) return isAbsoluteValue(explicit) ? explicit.trim() : null;
  return isSpecProcess(env) ? null : path.join(stateHome(env), 'chemx', 'board-claims');
};

const fileFor = (dir, handle) => path.join(dir, `${encodeURIComponent(String(handle))}.json`);

const isClaim = (entry) => Boolean(entry) && typeof entry.root === 'string' && Number.isInteger(entry.taskId) && Number.isFinite(entry.at);

const parseClaims = (text) => {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.claims) ? parsed.claims.filter(isClaim) : [];
  } catch {
    return []; // chemx-allow: best-effort a damaged pointer file is only a lost hint; the next claim rewrites it
  }
};

const readFileClaims = (file) => {
  try {
    return parseClaims(fs.readFileSync(file, 'utf-8'));
  } catch {
    return []; // chemx-allow: best-effort a missing pointer file means the handle claimed nothing yet
  }
};

/** The handle's recorded claims, newest first: [{ root, taskId, at }]. Empty when pointers are off. */
export const readBoardClaims = (handle, options = {}) => {
  const dir = boardClaimsDir(options.env ?? process.env);
  const canRead = Boolean(dir) && Boolean(handle);
  if (!canRead) return [];
  return readFileClaims(fileFor(dir, handle)).sort((a, b) => b.at - a.at);
};

const writeAtomically = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, 'utf-8');
  fs.renameSync(temp, file);
};

/**
 * Remembers that handle claimed taskId on the board at root.
 * @returns {boolean} whether the pointer was written (false when pointers are off or the write failed)
 */
export const recordBoardClaim = ({ handle, taskId, root }, options = {}) => {
  const env = options.env ?? process.env;
  const dir = boardClaimsDir(env);
  const canRecord = Boolean(dir) && Boolean(handle) && Boolean(root) && Number.isInteger(Number(taskId));
  if (!canRecord) return false;
  const file = fileFor(dir, handle);
  const entry = { root, taskId: Number(taskId), at: options.now ?? Date.now() };
  const others = readFileClaims(file).filter((claim) => !(claim.root === root && claim.taskId === entry.taskId));
  const kept = [entry, ...others.sort((a, b) => b.at - a.at)].slice(0, MAX_CLAIMS_PER_HANDLE);
  try {
    writeAtomically(file, `${JSON.stringify({ handle, claims: kept }, null, 2)}\n`);
    return true;
  } catch (err) {
    const isDebug = Boolean(env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[board-claims] pointer not written: ${err.message}\n`);
    return false;
  }
};

/**
 * Forgets that handle claimed taskId on the board at root (the task moved to someone else, #6766).
 * Removes only that board and task; the handle's file goes away with its last claim.
 * @returns {boolean} whether a pointer was removed (false when pointers are off, there was none, or the write failed)
 */
export const forgetBoardClaim = ({ handle, taskId, root }, options = {}) => {
  const env = options.env ?? process.env;
  const dir = boardClaimsDir(env);
  const canForget = Boolean(dir) && Boolean(handle) && Boolean(root) && Number.isInteger(Number(taskId));
  if (!canForget) return false;
  const file = fileFor(dir, handle);
  const claims = readFileClaims(file);
  const kept = claims.filter((claim) => !(claim.root === root && claim.taskId === Number(taskId)));
  const hasRemoved = kept.length < claims.length;
  if (!hasRemoved) return false;
  const isLastClaim = kept.length === 0;
  try {
    if (isLastClaim) fs.rmSync(file, { force: true });
    else writeAtomically(file, `${JSON.stringify({ handle, claims: kept }, null, 2)}\n`);
    return true;
  } catch (err) {
    const isDebug = Boolean(env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[board-claims] pointer not removed: ${err.message}\n`);
    return false;
  }
};
