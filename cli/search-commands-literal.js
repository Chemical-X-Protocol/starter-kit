// Presentation for `chemx q -g`: grep-style `path:line:text`, the searched scope and engine
// in every header, and an explicit "showing N of M" when matches are cut by -n.
import { ANSI } from './theme.js';
import { runLiteralSearch } from './search-literal.js';
import { resolveIndexRoot, normalizeScope } from './search-root.js';
import { STATUS, toExitCode } from './result-status.js';

const describeScope = (res, root, scopeKey) => {
  const hiddenNote = res.skipped.hidden ? 'hidden paths skipped (--hidden)' : 'hidden paths included';
  return `searched ${res.filesSearched} files in ${scopeKey} under ${root} via ${res.engine}; ${hiddenNote}; .gitignore honoured`;
};

const finish = (status, isCli) => {
  if (!isCli) return;
  process.exitCode = toExitCode(status);
  process.exit();
};

const failWith = (message, { isJson, isCli, isQuiet }) => {
  const isPrinted = !isQuiet;
  const shouldPrintJson = isPrinted && isJson;
  if (shouldPrintJson) process.stdout.write(JSON.stringify({ status: STATUS.FAIL, error: message }) + '\n');
  const shouldPrintText = isPrinted && !isJson;
  if (shouldPrintText) process.stderr.write(`chemx q -g: ${message}\n`);
  finish(STATUS.FAIL, isCli);
  return { status: STATUS.FAIL, error: message, matches: [] };
};

export const handleLiteralSearchCommand = (_db, query, {
  isCaseInsensitive = false, isLineOnly = false, isRegex = false, isHidden = false,
  limit = 20, isJson = false, isCli = true, cwd = process.cwd(), dir = null, engine = null, isQuiet = false, argProblems = []
} = {}) => {
  const hasQuery = typeof query === 'string' && query.length > 0;
  if (!hasQuery) return failWith('missing search pattern (use `chemx q -g -- <pattern>` for a pattern starting with -)', { isJson, isCli, isQuiet });

  const root = resolveIndexRoot(cwd);
  const hasDir = typeof dir === 'string' && dir.length > 0;
  const scope = hasDir ? normalizeScope(dir, root, cwd) : { scopeDirs: ['.'], scopeKey: '.', outside: [] };
  const hasOutside = scope.outside.length > 0;
  if (hasOutside) return failWith(`--dir ${scope.outside.join(', ')} is outside the project root ${root}`, { isJson, isCli, isQuiet });

  let res;
  try {
    res = runLiteralSearch({ root, scopeDirs: scope.scopeDirs, pattern: query, isRegex, isCaseInsensitive, isHidden, limit, engine });
  } catch (err) {
    return failWith(err instanceof Error ? err.message : String(err), { isJson, isCli, isQuiet });
  }

  const hasSearchedNothing = res.filesSearched === 0;
  const status = hasSearchedNothing ? STATUS.INCONCLUSIVE : STATUS.PASS;
  const payload = {
    status, query, mode: isRegex ? 'regex' : 'fixed', isCaseInsensitive, isLineOnly,
    engine: res.engine, root, scope: scope.scopeKey, filesSearched: res.filesSearched, filesMatched: res.filesMatched,
    count: res.matches.length, totalMatches: res.totalMatches, truncated: res.truncated, skipped: res.skipped,
    reason: hasSearchedNothing ? 'no searchable files in scope' : undefined,
    argProblems: argProblems.length > 0 ? argProblems : undefined,
    matches: isLineOnly ? res.matches.map((m) => ({ path: m.path, line: m.line })) : res.matches
  };

  if (isQuiet) return payload;
  if (isJson) {
    process.stdout.write(JSON.stringify(payload) + '\n');
    finish(status, isCli);
    return payload;
  }

  if (isLineOnly) {
    for (const m of res.matches) {
      process.stdout.write(`${m.path}:${m.line}\n`);
    }
    finish(status, isCli);
    return payload;
  }

  const plural = res.totalMatches === 1 ? '' : 'es';
  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Literal search${ANSI.RESET} "${query}" ${ANSI.DIM}(${payload.mode}${isCaseInsensitive ? ', ignore-case' : ''}): ${res.totalMatches} match${plural} in ${res.filesMatched} files${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.DIM}${describeScope(res, root, scope.scopeKey)}${ANSI.RESET}\n`);
  for (const m of res.matches) {
    const location = `${ANSI.BOLD}${m.path}${ANSI.RESET}:${ANSI.GOLD}${m.line}${ANSI.RESET}`;
    process.stdout.write(isLineOnly ? `${location}\n` : `${location}:${m.text}\n`);
  }
  const isTruncated = Boolean(res.truncated);
  if (isTruncated) process.stdout.write(`\n  ${ANSI.GOLD}Showing ${res.matches.length} of ${res.totalMatches} matches. Use -n <num> to see more, -l for path:line only.${ANSI.RESET}\n`);
  process.stdout.write('\n');
  finish(status, isCli);
  return payload;
};
