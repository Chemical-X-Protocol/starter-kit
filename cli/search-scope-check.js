// Which files or directories a `chemx q` call searches: the positional paths after the query (or --dir),
// relative to where chemx started. A path that is outside the project or missing is an error that names
// it, so a multi-word phrase typed without quotes (`q foo bar`) says how to quote it instead of
// searching the wrong thing.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeScope } from './search-root.js';

const WHOLE_PROJECT = Object.freeze({ scopeDirs: ['.'], scopeKey: '.', outside: [] });
const GLOB_CHARS = /[*?[\]{}]/;

// -> { scope } or { error }. `quoteExample` is the command a phrase would be quoted for, e.g. `chemx q -g`.
export const resolveSearchScope = ({ dir, query, root, cwd, quoteExample }) => {
  const hasDirString = typeof dir === 'string' && dir.length > 0;
  const hasDirList = Array.isArray(dir) && dir.length > 0;
  const hasDir = hasDirString || hasDirList;
  if (!hasDir) return { scope: WHOLE_PROJECT };
  const scope = normalizeScope(dir, root, cwd);
  const hasOutside = scope.outside.length > 0;
  if (hasOutside) return { error: `--dir ${scope.outside.join(', ')} is outside the project root ${root}` };
  const missing = scope.scopeDirs.filter((relDir) => !fs.existsSync(path.join(root, relDir)));
  const hasMissing = missing.length > 0;
  const phraseHint = Array.isArray(dir) ? `. To search for a phrase, quote it: ${quoteExample} "${[query, ...missing].join(' ')}"` : '';
  const hasPattern = missing.some((relDir) => GLOB_CHARS.test(relDir));
  const patternHint = hasPattern ? '. A path filter (positional paths, --dir, --glob) takes paths, not patterns: name the directory, or leave the pattern unquoted so the shell expands it (q -g foo cli/*.js)' : '';
  if (hasMissing) return { error: `path not found: ${missing.join(', ')}${phraseHint}${patternHint} (relative to ${root}); nothing was searched` };
  return { scope };
};
