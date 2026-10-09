// `chemx q -g`: a repo-wide literal search that can stand in for `grep -rn`.
// Fixed-string by default (--regex opts in), every text file .gitignore allows (submodules,
// docs, styles, json, php), full lines as path:line. System `rg` when present, else JS.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listLiteralSearchFiles } from './search-literal-files.js';
import { debugNote } from './search-debug.js';

const MAX_LINE_CHARS = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
let rgAvailability = null;

export const isRipgrepAvailable = () => {
  const hasCachedAnswer = rgAvailability !== null;
  if (hasCachedAnswer) return rgAvailability;
  const probe = spawnSync('rg', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
  rgAvailability = probe.status === 0;
  return rgAvailability;
};

const clampLine = (text) => {
  const clean = text.replace(/\r$/, '');
  const isLong = clean.length > MAX_LINE_CHARS;
  return isLong ? `${clean.slice(0, MAX_LINE_CHARS)} [+${clean.length - MAX_LINE_CHARS} chars]` : clean;
};

export const buildLineMatcher = ({ pattern, isRegex, isCaseInsensitive }) => {
  if (isRegex) {
    const regex = new RegExp(pattern, isCaseInsensitive ? 'i' : '');
    return (line) => regex.test(line);
  }
  const needle = isCaseInsensitive ? pattern.toLowerCase() : pattern;
  return isCaseInsensitive ? (line) => line.toLowerCase().includes(needle) : (line) => line.includes(needle);
};

const isBinaryBuffer = (buffer) => buffer.subarray(0, 8000).includes(0);

const searchWithJs = (root, scopeDirs, options, collect) => {
  const { files } = listLiteralSearchFiles(root, scopeDirs, { isHidden: options.isHidden });
  const matches = buildLineMatcher(options);
  const stats = { filesSearched: 0, skippedBinary: 0, skippedLarge: 0 };
  for (const rel of files) {
    let buffer;
    try {
      const size = fs.statSync(path.join(root, rel)).size;
      const isTooLarge = size > MAX_FILE_BYTES;
      if (isTooLarge) { stats.skippedLarge += 1; continue; }
      buffer = fs.readFileSync(path.join(root, rel));
    } catch (err) {
      debugNote.warn(`literal read ${rel}`, err);
      continue;
    }
    const isBinary = isBinaryBuffer(buffer);
    if (isBinary) { stats.skippedBinary += 1; continue; }
    stats.filesSearched += 1;
    const lines = buffer.toString('utf-8').split('\n');
    lines.forEach((line, idx) => {
      const isMatch = matches(line);
      if (isMatch) collect({ path: rel, line: idx + 1, text: clampLine(line) });
    });
  }
  return stats;
};

const RG_FILTER_ARGS = ['--no-config', '--glob', '!.git', '--glob', '!.claude', '--glob', '!.chemx'];

const runRipgrep = (root, args) => {
  const res = spawnSync('rg', args, { cwd: root, encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const isRgError = res.status !== 0 && res.status !== 1;
  if (isRgError) throw new Error(`rg failed: ${(res.stderr || '').trim()}`);
  return res.stdout || '';
};

// rg's --json summary only counts files it reported on (0 when nothing matches), so the
// searched-file count comes from `rg --files` under the same filters.
const countRipgrepFiles = (root, scopeDirs, options) => {
  const args = ['--files', ...RG_FILTER_ARGS];
  if (options.isHidden) args.push('--hidden');
  args.push('--', ...scopeDirs);
  return runRipgrep(root, args).split('\n').filter(Boolean).length;
};

const searchWithRipgrep = (root, scopeDirs, options, collect) => {
  const args = ['--json', ...RG_FILTER_ARGS, options.isCaseInsensitive ? '--ignore-case' : '--case-sensitive', '--sort', 'path'];
  if (!options.isRegex) args.push('--fixed-strings');
  if (options.isHidden) args.push('--hidden');
  args.push('--', options.pattern, ...scopeDirs);
  const stdout = runRipgrep(root, args);
  const stats = { filesSearched: countRipgrepFiles(root, scopeDirs, options), skippedBinary: 0, skippedLarge: 0 };
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const event = JSON.parse(raw);
    const isMatchEvent = event.type === 'match';
    if (!isMatchEvent) continue;
    const rel = (event.data.path.text || '').replace(/^\.\//, '');
    collect({ path: rel, line: event.data.line_number, text: clampLine((event.data.lines.text || '').replace(/\n$/, '')) });
  }
  return stats;
};

const resolveEngine = (requested) => {
  const isForcedJs = requested === 'js' || process.env.CHEMX_LITERAL_ENGINE === 'js';
  if (isForcedJs) return 'js';
  return isRipgrepAvailable() ? 'rg' : 'js';
};

// Returns { engine, filesSearched, filesMatched, totalMatches, matches (<= limit), truncated, skipped }.
export const runLiteralSearch = ({ root, scopeDirs = ['.'], pattern, isRegex = false, isCaseInsensitive = false, isHidden = false, limit = 20, engine = null }) => {
  const options = { pattern, isRegex, isCaseInsensitive, isHidden };
  const matches = [];
  const matchedFiles = new Set();
  let totalMatches = 0;
  const collect = (match) => {
    totalMatches += 1;
    matchedFiles.add(match.path);
    const hasRoom = matches.length < limit;
    if (hasRoom) matches.push(match);
  };
  const chosen = resolveEngine(engine);
  const search = chosen === 'rg' ? searchWithRipgrep : searchWithJs;
  const stats = search(root, scopeDirs, options, collect);
  return {
    engine: chosen, filesSearched: stats.filesSearched, filesMatched: matchedFiles.size, totalMatches,
    matches, truncated: totalMatches > matches.length,
    skipped: { binary: stats.skippedBinary, large: stats.skippedLarge, hidden: !isHidden }
  };
};
