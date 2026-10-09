/**
 * Audit coverage: how much of each scanned file the AST rules actually saw. A file
 * that only got line-level text checks (unsupported language, --fast, parse error,
 * an SFC template that failed to parse) is reported as partial so a low hazard
 * count is never presented as a confident pass.
 */
export const COVERAGE_KINDS = Object.freeze({
  AST: 'ast',
  TEXT_ONLY: 'text-only',
  PARSE_ERROR: 'parse-error',
  EMPTY: 'empty'
});

export const createCoverageCollector = () => ({ files: [] });

/** Records one file. `sfc` is { scriptBlocks, hasTemplate, isTemplateParsed } for .vue files. */
export const recordFileCoverage = (collector, { relativePath, kind, sfc = null }) => {
  if (!collector) return;
  collector.files.push({ relativePath, kind, sfc });
};

const isPartialEntry = (entry) => {
  const isAstless = entry.kind !== COVERAGE_KINDS.AST && entry.kind !== COVERAGE_KINDS.EMPTY;
  const hasUnparsedTemplate = Boolean(entry.sfc?.hasTemplate) && !entry.sfc?.isTemplateParsed;
  return isAstless || hasUnparsedTemplate;
};

export const summarizeCoverage = (collector) => {
  const entries = collector?.files ?? [];
  const countKind = (kind) => entries.filter((e) => e.kind === kind).length;
  const sfcEntries = entries.filter((e) => e.sfc);
  const partialFiles = entries.filter(isPartialEntry).map((e) => e.relativePath);
  const astFiles = countKind(COVERAGE_KINDS.AST);
  return {
    files: entries.length,
    astParsed: astFiles,
    textOnly: countKind(COVERAGE_KINDS.TEXT_ONLY),
    parseErrors: countKind(COVERAGE_KINDS.PARSE_ERROR),
    astPct: entries.length > 0 ? Math.round((astFiles / entries.length) * 100) : 100,
    sfc: {
      files: sfcEntries.length,
      scriptBlocks: sfcEntries.reduce((sum, e) => sum + (e.sfc.scriptBlocks ?? 0), 0),
      templatesParsed: sfcEntries.filter((e) => e.sfc.isTemplateParsed).length
    },
    isPartial: partialFiles.length > 0,
    partialFiles: partialFiles.slice(0, 20)
  };
};
