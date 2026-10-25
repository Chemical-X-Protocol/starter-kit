// `chemx q -g -o`: the text a pattern matched inside one line, for the JS engine (ripgrep reports its own
// submatches). Fixed strings are found with indexOf and keep the line's own case; regexes use matchAll.

const findFixed = (line, { pattern, isCaseInsensitive }) => {
  const haystack = isCaseInsensitive ? line.toLowerCase() : line;
  const needle = isCaseInsensitive ? pattern.toLowerCase() : pattern;
  const found = [];
  const isEmptyNeedle = needle.length === 0;
  if (isEmptyNeedle) return found;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    found.push(line.slice(from, from + needle.length));
    from = haystack.indexOf(needle, from + needle.length);
  }
  return found;
};

export const buildMatchFinder = ({ pattern, isRegex, isCaseInsensitive }) => {
  if (!isRegex) return (line) => findFixed(line, { pattern, isCaseInsensitive });
  const regex = new RegExp(pattern, isCaseInsensitive ? 'gi' : 'g');
  return (line) => Array.from(line.matchAll(regex), (m) => m[0]).filter((text) => text.length > 0);
};
