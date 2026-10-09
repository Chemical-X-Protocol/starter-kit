/**
 * Conflict awareness for chemx. DEPENDENCY-FREE BY DESIGN: this module imports only node:
 * built-ins, so cli/index.js can load it (and run `chemx conflicts` / `chemx d --conflicts`)
 * even when chemx's own sources are mid-merge and the rest of the CLI cannot be parsed.
 *
 * A hunk is git's default 7-character marker triple at column 0: an ours line, an optional
 * diff3 base line, a divider, and a theirs line. SEARCH/REPLACE edit blocks are not hunks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OURS_RE = /^<{7}(?: (.*))?$/;
const BASE_RE = /^\|{7}(?: (.*))?$/;
const MID_RE = /^={7}$/;
const THEIRS_RE = /^>{7}(?: (.*))?$/;

const isEditBlock = (oursLabel, theirsLabel) => oursLabel === 'SEARCH' && theirsLabel === 'REPLACE';

const readHunk = (lines, open) => {
  const hunk = { start: open + 1, oursLabel: OURS_RE.exec(lines[open])[1] ?? '', ours: [], base: null, theirs: [] };
  let side = 'ours';
  for (let i = open + 1; i < lines.length; i++) {
    const line = lines[i];
    const isBaseMarker = BASE_RE.test(line) && side === 'ours';
    if (isBaseMarker) { side = 'base'; hunk.base = []; continue; }
    const isMidMarker = MID_RE.test(line) && side !== 'theirs';
    if (isMidMarker) { side = 'theirs'; continue; }
    const close = side === 'theirs' ? THEIRS_RE.exec(line) : null;
    if (close) return { ...hunk, end: i + 1, theirsLabel: close[1] ?? '' };
    hunk[side].push(line);
  }
  return null;
};

/**
 * @param {string} text File content.
 * @returns {{ start: number, end: number, oursLabel: string, theirsLabel: string, ours: string[], theirs: string[], base: string[]|null }[]}
 */
export const findConflictHunks = (text) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const hunks = [];
  for (let i = 0; i < lines.length; i++) {
    const isOursMarker = OURS_RE.test(lines[i]);
    if (!isOursMarker) continue;
    const hunk = readHunk(lines, i);
    if (!hunk) break;
    i = hunk.end - 1;
    if (isEditBlock(hunk.oursLabel, hunk.theirsLabel)) continue;
    const { start, end, oursLabel, theirsLabel, ours, theirs, base } = hunk;
    hunks.push({ start, end, oursLabel, theirsLabel, ours, theirs, base });
  }
  return hunks;
};

const MARKER_PROBE = /^(<{7}|>{7})( |$)/m;

/** Cheap pre-check, then the full scan. Returns the hunks, or [] for clean text. */
export const conflictHunksOf = (text) => (MARKER_PROBE.test(String(text ?? '')) ? findConflictHunks(text) : []);

export const fileConflictHunks = (absPath) => {
  try {
    return conflictHunksOf(fs.readFileSync(absPath, 'utf-8'));
  } catch {
    return [];
  }
};

/** One line: "src/a.ts has unmerged conflict markers at L1 (HEAD | side), L20 (...)". */
export const describeConflicts = (relPath, hunks) => {
  const where = hunks.map((h) => `L${h.start} (${h.oursLabel || 'ours'} | ${h.theirsLabel || 'theirs'})`).join(', ');
  return `${relPath} has unmerged conflict markers at ${where}; AST tools skip it (see chemx conflicts)`;
};

/** "skipped N file(s) with unmerged conflict markers: a.ts:1, b.ts:9" */
export const describeSkipped = (entries) => {
  const list = entries.map((e) => `${e.path}:${e.hunks[0].start}`).join(', ');
  return `skipped ${entries.length} file${entries.length === 1 ? '' : 's'} with unmerged conflict markers: ${list} (see chemx conflicts)`;
};

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

const STAGE_NAMES = { 1: 'base', 2: 'ours', 3: 'theirs' };

/** Unmerged paths (relative to cwd) with the index stages git holds for each. */
export const listUnmergedPaths = (cwd = process.cwd()) => {
  const res = git(cwd, ['ls-files', '-u', '-z']);
  const isGitFailure = res.status !== 0;
  if (isGitFailure) return { isRepo: false, paths: [] };
  const byPath = new Map();
  for (const entry of res.stdout.split('\0').filter(Boolean)) {
    const [meta, file] = entry.split('\t');
    const stage = meta.split(' ')[2];
    byPath.set(file, [...(byPath.get(file) || []), STAGE_NAMES[stage] || stage]);
  }
  return { isRepo: true, paths: [...byPath].map(([file, stages]) => ({ path: file, stages })) };
};

/** @returns {{ isRepo: boolean, unmerged: { path: string, stages: string[], hunks: object[] }[] }} */
export const collectConflicts = (cwd = process.cwd()) => {
  const { isRepo, paths } = listUnmergedPaths(cwd);
  const unmerged = paths.map((p) => ({ ...p, hunks: fileConflictHunks(path.join(cwd, p.path)) }));
  return { isRepo, unmerged };
};
