// Dependency-free: extracts the parseable script of a source file (the <script> block of a
// Vue SFC, padded so line numbers stay aligned). Kept apart from rules-helpers.js so readers
// and the search indexer do not load @babel/types just to slice a file.
export const extractParseableCode = (content, ext) => {
  if (ext === '.vue') {
    const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return '';
    const scriptStartIndex = scriptMatch.index || 0;
    const preScript = content.slice(0, scriptStartIndex);
    const openTag = scriptMatch[0].match(/<script\b[^>]*>/i)?.[0] || '';
    const preContent = preScript + openTag;
    const leadingNewlines = preContent.split('\n').length - 1;
    return '\n'.repeat(leadingNewlines) + scriptMatch[1];
  }
  return content;
};
