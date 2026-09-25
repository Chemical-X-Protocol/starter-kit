const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'as', 'into', 'is', 'are', 'was', 'were', 'it', 'its', 'or',
  'and', 'be', 'been', 'this', 'that', 'these', 'those', 'then'
]);

export const splitIdentifierToSubwords = (ident) => {
  if (!ident || typeof ident !== 'string') return [];
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_./\\]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
};

export const buildFtsTokens = ({ symbols = [], props = [], hooks = [], imports = [], filePath = '' } = {}) => {
  const rawIdentifiers = [
    ...symbols.map((s) => s.name),
    ...props.map((p) => p.name),
    ...hooks,
    ...imports.map((i) => i.importedSymbol),
    filePath
  ].filter(Boolean);

  const subwords = new Set();
  for (const id of rawIdentifiers) {
    for (const w of splitIdentifierToSubwords(id)) {
      subwords.add(w);
    }
  }

  return [...rawIdentifiers, ...subwords].join(' ');
};

export const formatFtsQuery = (queryText = '') => {
  if (!queryText || typeof queryText !== 'string') return null;

  const rawTerms = splitIdentifierToSubwords(queryText);
  const terms = rawTerms.filter((w) => !STOP_WORDS.has(w) && w.length > 1);

  if (terms.length === 0) {
    if (rawTerms.length > 0) return `"${rawTerms.join(' ')}"`;
    return null;
  }

  const prefixTerms = terms.map((t) => `${t}*`);
  const phrase = `"${terms.join(' ')}"`;

  return `${phrase} OR ${prefixTerms.join(' OR ')}`;
};
