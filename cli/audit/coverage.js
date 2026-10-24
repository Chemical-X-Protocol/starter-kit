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

/**
 * Records one file. `sfc` is { scriptBlocks, hasTemplate, isTemplateParsed } for .vue files;
 * `language` (language id) and `reason` (why the file was not fully parsed) are optional.
 */
export const recordFileCoverage = (collector, { relativePath, kind, sfc = null, language = null, reason = null }) => {
  if (!collector) return;
  collector.files.push({ relativePath, kind, sfc, language, reason });
};

const BUCKET_FIELD_BY_KIND = {
  [COVERAGE_KINDS.AST]: 'ast',
  [COVERAGE_KINDS.TEXT_ONLY]: 'textOnly',
  [COVERAGE_KINDS.PARSE_ERROR]: 'parseErrors'
};

const summarizeByLanguage = (entries) => {
  const byLanguage = {};
  for (const entry of entries) {
    if (!entry.language) continue;
    const bucket = byLanguage[entry.language] ?? { files: 0, ast: 0, textOnly: 0, parseErrors: 0 };
    bucket.files += 1;
    const field = BUCKET_FIELD_BY_KIND[entry.kind];
    const isCounted = Boolean(field);
    if (isCounted) bucket[field] += 1;
    byLanguage[entry.language] = bucket;
  }
  return byLanguage;
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
    byLanguage: summarizeByLanguage(entries),
    isPartial: partialFiles.length > 0,
    partialFiles: partialFiles.slice(0, 20)
  };
};
