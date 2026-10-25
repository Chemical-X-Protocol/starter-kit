// `chemx q <text>` found no symbol: run the fixed-string search in the same call and label it, so the
// next step is not a second command. Text mode prints the labelled section; json gets the answer as `literal`.
import { handleLiteralSearchCommand } from './search-commands-literal.js';

export const FALLBACK_HEADING = 'no symbols; fixed-string matches:';
const FALLBACK_LIMIT = 20;

// A tier filter has no literal meaning, so it keeps the empty answer.
export const shouldFallBack = (page, query, tier) => page.total === 0 && query.length > 0 && !tier;

export const runLiteralFallback = (query, { cwd, dir, limit, isJson }) => handleLiteralSearchCommand(null, query, {
  isCli: false, isQuiet: isJson, isJson: false, cwd, dir, limit: limit ?? FALLBACK_LIMIT, heading: FALLBACK_HEADING
});
