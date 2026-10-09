// Babel-parsable code for a file, without importing Babel. For .vue this is the shared SFC
// script overlay (every <script> block in place, everything else blanked, so lines match
// the file). Kept apart from rules-helpers.js so readers and the search indexer do not load
// @babel/types just to slice a file; sfc-parse.js loads @vue/compiler-sfc only on first use.
import { parseSfc } from '../sfc/sfc-parse.js';

export const extractParseableCode = (content, ext, filePath = 'component.vue') => {
  const isVue = ext === '.vue';
  if (isVue) return parseSfc(content, filePath).scriptOverlay;
  return content;
};
