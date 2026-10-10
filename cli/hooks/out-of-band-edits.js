// PostToolUse(Bash) backstop: after a Bash call, list repo files whose content changed since the
// previous Bash hook run, when the call was not a chemx command. Command-text guards cannot see
// every writer (any interpreter, any script file); this looks at the files instead.
// Guarantees: only dirty files that git reports (git status --porcelain) and that have a write
// extension are looked at; a file is flagged when its sha1 differs from the one last recorded, or when
// it is new to the record and was modified after the record was last written. NOT guaranteed: the first
// call in a checkout only records a baseline; a call made only of chemx commands is treated as
// in-band as a whole (a chemx command chained with other commands is scanned); chemx patch/write do
// not yet record sha1s, so a Bash call is the only place the record is refreshed or a non-Bash
// writer is covered, via the PostToolUse hook for MCP chemx and Edit/Write; a file changed by a peer's non-chemx write between two hook runs is attributed to
// whoever ran the next Bash call; a write that leaves git status unchanged (already-dirty file with
// the same stat) is missed. The record lives at <root>/.chemx/post-bash-seen.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isRepoWritePath } from './guard-paths.js';
import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';

export const OUT_OF_BAND_RULE = 'out_of_band_edit';
const SEEN_FILE = ['.chemx', 'post-bash-seen.json'];
const MAX_LISTED = 5;

// True only when every simple command in the call is a chemx invocation. A chemx command chained
// with anything else (`chemx test && node x.mjs`) is not exempt.
export const callsChemx = (command) => {
  try {
    const commands = parseShell(String(command ?? '')).commands;
    return commands.length > 0 && commands.every((parsed) => parsed.argv.length > 0 && isChemxInvocation(resolveInvocation(parsed.argv)));
  } catch { // chemx-allow: best-effort an unparsable command is judged not to be a chemx call
    return false;
  }
};

// `git status --porcelain -z`: "XY path\0", a rename or copy adds "origPath\0". Deleted files are skipped.
export const parsePorcelain = (text) => {
  const parts = String(text ?? '').split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const isEntry = entry.length > 3;
    if (!isEntry) continue;
    const status = entry.slice(0, 2);
    const isRename = status.includes('R') || status.includes('C');
    if (isRename) i += 1;
    const isDeleted = status.includes('D');
    if (!isDeleted) files.push(entry.slice(3));
  }
  return files;
};

const dirtyFiles = (root) => {
  const run = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  const isOk = run.status === 0 && typeof run.stdout === 'string';
  return isOk ? parsePorcelain(run.stdout) : null;
};

const sha1Of = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

const readSeen = (file) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const isValid = parsed && typeof parsed === 'object' && typeof parsed.at === 'number' && parsed.files && typeof parsed.files === 'object';
    return isValid ? parsed : null;
  } catch { // chemx-allow: best-effort a missing or corrupt record is a fresh baseline
    return null;
  }
};

const writeSeen = (file, seen) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(seen));
  fs.renameSync(temp, file);
};

const statOf = (absolute) => {
  try {
    const stat = fs.statSync(absolute);
    return stat.isFile() ? stat : null;
  } catch { // chemx-allow: best-effort a file that vanished between git status and stat is skipped
    return null;
  }
};

// One dirty file against the record: { entry, isChanged }. isChanged is false for an unchanged stat.
const judgeFile = ({ absolute, stat, known, previous }) => {
  const isStatSame = Boolean(known) && known.m === stat.mtimeMs && known.s === stat.size;
  if (isStatSame) return { entry: known, isChanged: false };
  const hash = sha1Of(absolute);
  const entry = { m: stat.mtimeMs, s: stat.size, h: hash };
  const isNewToRecord = !known;
  const isModifiedSince = previous !== null && stat.mtimeMs > previous.at;
  return { entry, isChanged: isNewToRecord ? isModifiedSince : known.h !== hash };
};

// Returns { changed: [relative paths], baseline: boolean } or null when git is unusable.
// isInBandTool: the call was a non-Bash chemx writer (MCP chemx, Edit/Write after their own gates);
// the record is refreshed and nothing is flagged.
export const scanOutOfBand = ({ root, command, now = Date.now(), isInBandTool = false }) => {
  const dirty = dirtyFiles(root);
  const isGitUnusable = dirty === null;
  if (isGitUnusable) return null;
  const seenFile = path.join(root, ...SEEN_FILE);
  const previous = readSeen(seenFile);
  // Parsing the command is only needed once a file has changed, so a quiet call skips it.
  const isInBandFor = () => isInBandTool || callsChemx(command);
  const files = {};
  const changed = [];
  for (const relative of dirty) {
    const absolute = path.join(root, relative);
    const stat = isRepoWritePath(absolute, { cwd: root, root }) ? statOf(absolute) : null;
    const isSkipped = stat === null;
    if (isSkipped) continue;
    const verdict = judgeFile({ absolute, stat, known: previous?.files[relative], previous });
    files[relative] = verdict.entry;
    const isOutOfBand = verdict.isChanged && !isInBandFor();
    if (isOutOfBand) changed.push(relative);
  }
  writeSeen(seenFile, { at: now, files });
  return { changed, baseline: previous === null };
};

export const outOfBandMessage = (changed) => {
  const listed = changed.slice(0, MAX_LISTED).join(', ');
  const more = changed.length > MAX_LISTED ? ` and ${changed.length - MAX_LISTED} more` : '';
  const verb = changed.length === 1 ? 'was' : 'were';
  return `chemx: ${listed}${more} ${verb} changed by a Bash call that was not a chemx command (written outside chemx). Redo the change with chemx patch or chemx write so leases and gates apply. The edit is logged as an out_of_band_edit bypass. This check is best effort: it sees git-dirty files only, and a peer's write between two Bash calls can be attributed to you.`;
};
