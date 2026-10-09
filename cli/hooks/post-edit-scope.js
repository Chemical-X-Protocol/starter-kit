// Which hazards a post-edit check reports. 'file' (default) keeps every hazard in the edited file;
// a git ref (CHEMX_POST_EDIT_SINCE=HEAD) keeps only hazards on lines changed since that ref.
// New scopes plug in here without touching the hook.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export const parseChangedRanges = (diffText) => {
  const ranges = [];
  for (const line of diffText.split('\n')) {
    const match = line.match(HUNK);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const isPureDeletion = count === 0;
    if (!isPureDeletion) ranges.push([start, start + count - 1]);
  }
  return ranges;
};

// null means "every line" (untracked file, or git unavailable): fall back to the whole file.
export const changedLinesSince = (file, ref, cwd) => {
  const relative = path.relative(cwd, file);
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], { cwd, encoding: 'utf-8' });
  const isTracked = tracked.status === 0;
  if (!isTracked) return null;
  const diff = spawnSync('git', ['diff', '-U0', '--no-color', ref, '--', relative], { cwd, encoding: 'utf-8' });
  const hasDiff = diff.status === 0;
  return hasDiff ? parseChangedRanges(diff.stdout) : null;
};

const isInRanges = (line, ranges) => ranges.some(([start, end]) => line >= start && line <= end);

export const scopeViolations = (violations, { file, cwd, since = null }) => {
  const isWholeFile = !since;
  if (isWholeFile) return { scope: 'file', violations };
  const ranges = changedLinesSince(file, since, cwd);
  const isUnknown = ranges === null;
  if (isUnknown) return { scope: 'file', violations };
  return { scope: `since ${since}`, violations: violations.filter((violation) => isInRanges(violation.line ?? 1, ranges)) };
};
