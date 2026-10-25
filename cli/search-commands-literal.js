// Presentation for `chemx q -g`: grep-style `path:line:text`, the searched scope and engine
// in every header, and an explicit "showing N of M" when matches are cut by -n.
import { ANSI } from './theme.js';
import { runLiteralSearch } from './search-literal.js';
import { resolveIndexRoot } from './search-root.js';
import { resolveSearchScope } from './search-scope-check.js';
import { STATUS, toExitCode } from './result-status.js';
import { looksLikeRegex } from './search-regex-guard.js';
import { renderPlain, isListMode, describeScopePaths } from './search-literal-view.js';

const describeScope = (res, root, scopeDirs) => {
  const hiddenNote = res.skipped.hidden ? 'dot-directories searched; git-ignored paths skipped (--hidden includes them)' : 'git-ignored paths included';
  return `searched ${res.filesSearched} files in ${describeScopePaths(scopeDirs)} under ${root} via ${res.engine}; ${hiddenNote}`;
};

const finish = (status, isCli) => {
  if (!isCli) return;
  process.exitCode = toExitCode(status);
  process.exit();
};

export const failWith = (message, { isJson, isCli, isQuiet, label = 'chemx q -g' }) => {
  const isPrinted = !isQuiet;
  const shouldPrintJson = isPrinted && isJson;
  if (shouldPrintJson) process.stdout.write(JSON.stringify({ status: STATUS.FAIL, error: message }) + '\n');
  const shouldPrintText = isPrinted && !isJson;
  if (shouldPrintText) process.stderr.write(`${label}: ${message}\n`);
  finish(STATUS.FAIL, isCli);
  return { status: STATUS.FAIL, error: message, matches: [] };
};

// A fixed-string search for a|b finds nothing and looks like a clean negative: say why.
const buildRegexHint = (query, res, isRegex) => {
  const isRegexShaped = !isRegex && res.totalMatches === 0 && looksLikeRegex(query);
  return isRegexShaped ? `fixed string: ${JSON.stringify(query)} was searched as literal text (| . * \\ [ ] are plain characters) and matched nothing; add --regex to search it as a regular expression` : undefined;
};

const shapeMatches = (res, { isListOnly, isOnlyMatching, isLineOnly }) => {
  if (isListOnly) return [];
  if (isOnlyMatching) return res.matches.map((m) => ({ path: m.path, line: m.line, parts: m.parts }));
  return isLineOnly ? res.matches.map((m) => ({ path: m.path, line: m.line })) : res.matches;
};

// -o lists the distinct texts; with --unique the list is the capped one that was printed.
const pickDistinct = (res, listing, { isUnique, isOnlyMatching }) => {
  if (!isOnlyMatching) return undefined;
  return isUnique ? listing.lines : res.distinct;
};

const writePlain = (res, modes, limit, hint) => {
  const out = renderPlain(res, modes, limit);
  const hasLines = out.lines.length > 0;
  if (hasLines) process.stdout.write(`${out.lines.join('\n')}\n`);
  const hasNothingShown = out.shown === 0;
  if (hasNothingShown) process.stderr.write('no matches\n');
  const isCut = out.shown < out.total;
  if (isCut) process.stderr.write(`showing ${out.shown} of ${out.total} ${out.unit} (use -n <num> to see more)\n`);
  if (hint) process.stderr.write(`${hint}\n`);
};

const writeContextRows = (matches) => {
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const hasBeforeContext = Boolean(m.before && m.before.length > 0);
    const hasAfterContext = Boolean(m.after && m.after.length > 0);
    const hasContext = hasBeforeContext || hasAfterContext;
    const isSubsequentMatch = i > 0;
    const shouldSeparateChunk = hasContext && isSubsequentMatch;
    if (shouldSeparateChunk) process.stdout.write(`${ANSI.DIM}--${ANSI.RESET}\n`);
    for (const b of m.before || []) process.stdout.write(`${ANSI.DIM}${m.path}-${b.line}-${b.text}${ANSI.RESET}\n`);
    process.stdout.write(`${ANSI.BOLD}${m.path}${ANSI.RESET}:${ANSI.GOLD}${m.line}${ANSI.RESET}:${m.text}\n`);
    for (const a of m.after || []) process.stdout.write(`${ANSI.DIM}${m.path}-${a.line}-${a.text}${ANSI.RESET}\n`);
  }
};

const writeReport = (res, payload, { root, scopeDirs, heading, hint }) => {
  const plural = res.totalMatches === 1 ? '' : 'es';
  const counts = `${res.totalMatches} match${plural} in ${res.filesMatched} files`;
  const modeNote = `${payload.mode === 'regex' ? 'regex' : 'fixed string'}${payload.isCaseInsensitive ? ', ignore-case' : ''}`;
  const title = heading ? `${ANSI.BOLD}${ANSI.CYAN}${heading}${ANSI.RESET} ${ANSI.DIM}${counts}${ANSI.RESET}` : `${ANSI.BOLD}${ANSI.CYAN}Literal search${ANSI.RESET} "${payload.query}" ${ANSI.DIM}(${modeNote}): ${counts}${ANSI.RESET}`;
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`  ${ANSI.DIM}${describeScope(res, root, scopeDirs)}${ANSI.RESET}\n`);
  if (hint) process.stdout.write(`  ${ANSI.GOLD}${hint}${ANSI.RESET}\n`);
  writeContextRows(res.matches);
  const isTruncated = Boolean(res.truncated);
  if (isTruncated) process.stdout.write(`\n  ${ANSI.GOLD}Showing ${res.matches.length} of ${res.totalMatches} matches. Use -n <num> to see more, -l for the files only, --lines for path:line.${ANSI.RESET}\n`);
  process.stdout.write('\n');
};

export const handleLiteralSearchCommand = (_db, query, {
  isCaseInsensitive = false, isLineOnly = false, isFilesOnly = false, isOnlyMatching = false, isUnique = false,
  isRegex = false, isHidden = false,
  limit = 20, isJson = false, isCli = true, cwd = process.cwd(), dir = null, engine = null, isQuiet = false, argProblems = [],
  isBare = false, context = 0, beforeContext = 0, afterContext = 0, heading = null
} = {}) => {
  const hasQuery = typeof query === 'string' && query.length > 0;
  if (!hasQuery) return failWith('missing search pattern (use `chemx q -g -- <pattern>` for a pattern starting with -)', { isJson, isCli, isQuiet });

  const root = resolveIndexRoot(cwd);
  const { scope, error } = resolveSearchScope({ dir, query, root, cwd, quoteExample: 'chemx q -g' });
  if (error) return failWith(error, { isJson, isCli, isQuiet });

  const wantsParts = isOnlyMatching || isUnique;
  const modes = { isFilesOnly, isUnique, isOnlyMatching: wantsParts, isLineOnly };
  const isListOnly = isListMode(modes);
  let res;
  try {
    // A file list and a distinct list need no match rows, so the search keeps none.
    res = runLiteralSearch({ root, scopeDirs: scope.scopeDirs, pattern: query, isRegex, isCaseInsensitive, isHidden, isOnlyMatching: wantsParts, limit: isListOnly ? 0 : limit, engine, context, beforeContext, afterContext });
  } catch (err) {
    return failWith(err instanceof Error ? err.message : String(err), { isJson, isCli, isQuiet });
  }

  const hasSearchedNothing = res.filesSearched === 0;
  const status = hasSearchedNothing ? STATUS.INCONCLUSIVE : STATUS.PASS;
  const hint = buildRegexHint(query, res, isRegex);
  const listing = renderPlain(res, modes, limit);
  const lists = { files: isFilesOnly ? listing.lines : undefined, distinct: pickDistinct(res, listing, modes) };
  const payload = {
    status, query, mode: isRegex ? 'regex' : 'fixed', isCaseInsensitive, isLineOnly, isFilesOnly, isOnlyMatching: wantsParts, isUnique, isBare,
    engine: res.engine, root, scope: scope.scopeKey, filesSearched: res.filesSearched, filesMatched: res.filesMatched,
    count: isListOnly ? listing.shown : res.matches.length, totalMatches: res.totalMatches, truncated: isListOnly ? listing.shown < listing.total : res.truncated, skipped: res.skipped,
    reason: hasSearchedNothing ? 'no searchable files in scope' : undefined,
    hint,
    argProblems: argProblems.length > 0 ? argProblems : undefined,
    ...lists,
    matches: shapeMatches(res, { isListOnly, isOnlyMatching: wantsParts, isLineOnly })
  };

  if (isQuiet) return payload;
  if (isJson) {
    process.stdout.write(JSON.stringify(payload) + '\n');
    finish(status, isCli);
    return payload;
  }

  const isPlain = isBare || isLineOnly || isFilesOnly || wantsParts;
  if (isPlain) {
    // stderr keeps stdout as bare records for pipes.
    writePlain(res, modes, limit, hint);
  } else {
    writeReport(res, payload, { root, scopeDirs: scope.scopeDirs, heading, hint });
  }
  finish(status, isCli);
  return payload;
};
