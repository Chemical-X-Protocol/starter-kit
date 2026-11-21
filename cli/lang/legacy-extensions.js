/**
 * The extensions a ratchet scope without `languages` was recorded over: everything the
 * kit scanned before PHP support. Frozen on purpose: registering a language later must
 * never turn an old baseline's unscanned extension into a gated one (it is adopted instead).
 */
export const LEGACY_LANGUAGES = Object.freeze([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.cxx', '.go', '.h', '.hh', '.hpp', '.hxx', '.inl',
  '.java', '.js', '.jsx', '.kt', '.mjs', '.py', '.rs', '.svelte', '.ts', '.tsx', '.vue'
]);
