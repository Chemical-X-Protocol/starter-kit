/**
 * Chemical X Protocol: which db holds the team rows for a directory (#2488). Read-only and light
 * (no code-index modules), so hooks can use it: session presence, the SessionStart brief.
 * The answer is <coordination root>/.chemx/index.db (coordination-root.js), with one transition
 * rule: a package db on the way up from the start dir that still holds team rows and is not
 * recorded in the coordination db's team_merge_runs keeps serving that package (mode 'legacy').
 * Landing this code therefore moves nobody's backlog; `chemx team migrate` does, one package at
 * a time, and every entry point follows the merge record from then on. A merge never writes the
 * source db.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveCoordinationRoot, ancestorsOf, isInsideOrEqual } from './coordination-root.js';
import { owningRepo } from './coordination-repos.js';
import { openTeamDbReadOnly, closeQuietly, safeGet, safeAll } from './team-db-readonly.js';

const TEAM_ROWS_SQL = 'SELECT (SELECT COUNT(*) FROM agent_tasks) + (SELECT COUNT(*) FROM agent_feed) AS n';
const MERGED_SQL = 'SELECT DISTINCT source_db FROM team_merge_runs';

const realDir = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

export const teamDbPathFor = (root) => path.join(root, '.chemx', 'index.db');

/** Real paths of the package dbs the coordination db at root has merged (read-only). */
export const mergedSourceDbs = (root) => {
  const db = openTeamDbReadOnly(root);
  const hasDb = Boolean(db);
  if (!hasDb) return new Set();
  try {
    return new Set(safeAll(db, MERGED_SQL).map((row) => row.source_db));
  } finally {
    closeQuietly(db);
  }
};

const holdsTeamRows = (dir) => {
  const db = openTeamDbReadOnly(dir);
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  try {
    return Number(safeGet(db, TEAM_ROWS_SQL)?.n ?? 0) > 0;
  } finally {
    closeQuietly(db);
  }
};

/** True when dir/.chemx/index.db holds team rows the coordination db has not merged. */
export const isUnmergedSilo = (dir, merged) => {
  const dbPath = teamDbPathFor(dir);
  const isMerged = fs.existsSync(dbPath) && merged.has(fs.realpathSync(dbPath));
  return !isMerged && holdsTeamRows(dir);
};

const findSilo = (start, coordinationRoot) => {
  const candidates = ancestorsOf(start).filter((dir) => dir !== coordinationRoot && isInsideOrEqual(coordinationRoot, dir));
  const hasCandidates = candidates.some((dir) => fs.existsSync(teamDbPathFor(dir)));
  if (!hasCandidates) return null;
  const merged = mergedSourceDbs(coordinationRoot);
  return candidates.find((dir) => isUnmergedSilo(dir, merged)) ?? null;
};

/**
 * Where team rows for startDir live, without opening anything for writing.
 * @returns {{ root: string, coordinationRoot: string, mode: string, repo: string, dbPath: string, refused: string|null }}
 */
export const resolveTeamDbTarget = (startDir = process.cwd(), options = {}) => {
  const start = realDir(startDir);
  const resolved = resolveCoordinationRoot(start, options);
  const silo = resolved.refused ? null : findSilo(start, resolved.root);
  const root = silo || resolved.root;
  const repo = owningRepo(root, start) ?? '.';
  return { root, coordinationRoot: resolved.root, mode: silo ? 'legacy' : resolved.mode, repo, dbPath: teamDbPathFor(root), refused: resolved.refused };
};

const isMergedDir = (dir, merged) => {
  try {
    return merged.has(fs.realpathSync(teamDbPathFor(dir)));
  } catch {
    return false; // chemx-allow: best-effort a db that vanished since the existence check holds nothing to merge
  }
};

/**
 * Every existing db that can hold team rows or leases for startDir, nearest first: each package db
 * between startDir and the coordination root that the coordination db has not merged, then the
 * coordination db itself. Readers of leases and task state (chemx status, chemx wait, the edit and
 * commit guards, lock requests) use this list instead of walking every ancestor: nothing outside the
 * coordination root is read, and a refused caller (a spec process outside the temp dir, a temp dir
 * or filesystem root) gets an empty list. Only existing dbs are listed; none is created.
 */
export const teamDbRootsFor = (startDir = process.cwd(), options = {}) => {
  const start = realDir(startDir);
  const resolved = resolveCoordinationRoot(start, options);
  const isRefused = Boolean(resolved.refused);
  if (isRefused) return [];
  const withDb = ancestorsOf(start).filter((dir) => isInsideOrEqual(resolved.root, dir) && fs.existsSync(teamDbPathFor(dir)));
  const packageDirs = withDb.filter((dir) => dir !== resolved.root);
  const merged = packageDirs.length > 0 ? mergedSourceDbs(resolved.root) : new Set();
  const unmerged = packageDirs.filter((dir) => !isMergedDir(dir, merged));
  const hasRootDb = withDb.includes(resolved.root);
  return hasRootDb ? [...unmerged, resolved.root] : unmerged;
};

/** The root whose db holds startDir's team rows, or null when the caller is refused (specs). */
export const teamRootFor = (startDir, options = {}) => {
  const target = resolveTeamDbTarget(startDir, options);
  return target.refused ? null : target.root;
};
