// `chemx q -g ...` argv -> the pattern and the options handleLiteralSearchCommand takes.
// -l lists files (rg -l), --lines lists path:line, -o prints the matched text and --unique its distinct values.
import { hasAnyFlag, readIntValue } from './search-args.js';

const DEFAULT_LIMIT = 20;

export const readLiteralArgs = (parsed) => {
  const hasPatternToken = parsed.pattern !== null;
  const pattern = hasPatternToken ? parsed.pattern : parsed.positionals[0];
  const pathArgs = hasPatternToken ? parsed.positionals : parsed.positionals.slice(1);
  const hasPathArgs = pathArgs.length > 0;
  const isFilesOnly = hasAnyFlag(parsed, ['-l', '--files-with-matches']);
  const isLineOnly = hasAnyFlag(parsed, ['--lines']);
  const isUnique = parsed.flags.has('--unique');
  const isOnlyMatching = hasAnyFlag(parsed, ['-o', '--only-matching']) || isUnique;
  const isBare = hasAnyFlag(parsed, ['--bare', '-b']);
  const isPlainMode = isBare || isLineOnly || isFilesOnly || isOnlyMatching;
  const context = parsed.values.context !== undefined ? readIntValue(parsed, 'context', 0) : 0;
  const hasLimit = parsed.values.limit !== undefined;
  const defaultLimit = isPlainMode ? Number.MAX_SAFE_INTEGER : DEFAULT_LIMIT;
  return {
    pattern,
    options: {
      isCaseInsensitive: hasAnyFlag(parsed, ['-i', '--ignore-case']),
      isLineOnly, isFilesOnly, isOnlyMatching, isUnique, isBare, context,
      beforeContext: parsed.values.beforeContext !== undefined ? readIntValue(parsed, 'beforeContext', 0) : context,
      afterContext: parsed.values.afterContext !== undefined ? readIntValue(parsed, 'afterContext', 0) : context,
      isRegex: parsed.flags.has('--regex'),
      isHidden: parsed.flags.has('--hidden'),
      limit: hasLimit ? readIntValue(parsed, 'limit', DEFAULT_LIMIT) : defaultLimit,
      dir: parsed.values.dir ?? (hasPathArgs ? pathArgs : null)
    }
  };
};
