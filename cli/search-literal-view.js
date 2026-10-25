// Plain-text records for `chemx q -g` in its pipe modes (--bare, -l, --lines, -o, --unique), shared by the
// CLI and the MCP tool so both print the same bytes. One record per line, no header, no colour.

const contextRecords = (matches) => {
  const records = [];
  let lastPath = null;
  let lastLine = null;
  matches.forEach((m, i) => {
    const hasBefore = Boolean(m.before && m.before.length > 0);
    const hasAfter = Boolean(m.after && m.after.length > 0);
    const hasContext = hasBefore || hasAfter;
    const isSubsequentMatch = i > 0;
    const shouldCheckGap = hasContext && isSubsequentMatch;
    if (shouldCheckGap) {
      const isNonContiguous = lastPath !== m.path || (m.before?.[0]?.line ?? m.line) > (lastLine + 1);
      if (isNonContiguous) records.push('--');
    }
    for (const b of m.before || []) records.push(`${m.path}-${b.line}-${b.text}`);
    records.push(`${m.path}:${m.line}:${m.text}`);
    for (const a of m.after || []) records.push(`${m.path}-${a.line}-${a.text}`);
    lastPath = m.path;
    lastLine = m.after?.[m.after.length - 1]?.line ?? m.line;
  });
  return records;
};

// First mode that is on wins: a file list and a distinct list are capped by -n, the rest are capped by the search itself.
const MODES = [
  { flag: 'isFilesOnly', unit: 'files', isList: true, records: (res) => res.files },
  { flag: 'isUnique', unit: 'values', isList: true, records: (res) => res.distinct || [] },
  { flag: 'isOnlyMatching', unit: 'matches', isList: false, records: (res) => res.matches.flatMap((m) => (m.parts || []).map((part) => `${m.path}:${m.line}:${part}`)) },
  { flag: 'isLineOnly', unit: 'matches', isList: false, records: (res) => res.matches.map((m) => `${m.path}:${m.line}`) }
];

const DEFAULT_MODE = { unit: 'matches', isList: false, records: (res) => contextRecords(res.matches) };

export const isListMode = (modes) => MODES.some((mode) => mode.isList && modes[mode.flag]);

// The report header names the scoped paths; a shell-expanded glob can scope hundreds, so it lists a few and counts the rest.
export const HEADER_PATH_CAP = 5;

export const describeScopePaths = (scopeDirs, cap = HEADER_PATH_CAP) => {
  const listed = scopeDirs.slice(0, cap).join(',');
  const hiddenCount = scopeDirs.length - cap;
  const hasHidden = hiddenCount > 0;
  return hasHidden ? `${listed} (+${hiddenCount} more)` : listed;
};

// -> { lines, shown, total, unit }: shown of total is what the "showing N of M" notice quotes.
export const renderPlain = (res, modes = {}, limit = Number.MAX_SAFE_INTEGER) => {
  const mode = MODES.find((candidate) => modes[candidate.flag]) || DEFAULT_MODE;
  const all = mode.records(res);
  const lines = mode.isList ? all.slice(0, limit) : all;
  return { lines, shown: mode.isList ? lines.length : res.matches.length, total: mode.isList ? all.length : res.totalMatches, unit: mode.unit };
};
