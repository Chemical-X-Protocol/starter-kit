/**
 * Inconclusive audit results: a file whose language has an AST parser but whose coverage record
 * is not "ast" (--fast, parser unavailable, minified, parse error) was only partly examined, so a
 * low hazard count says nothing about it. Shared by `chemx check`, the edit guardrails and
 * `task done`. An empty file is conclusive; a language with no AST parser is never inconclusive.
 */
import path from 'node:path';
import { LANGUAGE_DEFINITIONS, getLanguageByExtension, isSourceFile } from '../languages.js';

const AST_PARSERS = new Set(['babel', 'php']);
const NO_REASON = 'no reason recorded';

const hasAstParser = (language) => language === 'php' || AST_PARSERS.has(LANGUAGE_DEFINITIONS[language]?.parser);

/** @param {{ kind?: string, language?: string|null, reason?: string|null }|null|undefined} coverage */
export const isInconclusive = (coverage) => {
  const hasLanguage = Boolean(coverage && coverage.language);
  if (!hasLanguage) return false;
  const isCovered = coverage.kind === 'ast' || coverage.kind === 'empty';
  return hasAstParser(coverage.language) && !isCovered;
};

/** The "inconclusive: <reason>" text for a coverage record, or null when the result is conclusive. */
export const inconclusiveReason = (coverage) => (isInconclusive(coverage) ? (coverage.reason || coverage.kind || NO_REASON) : null);

/**
 * True for a file the audit accepts: a known source extension, or one whose language was added to
 * LANGUAGE_DEFINITIONS after load (the extension table is built once, so this also lets specs
 * register a language). Tests count as source, matching auditFile.
 */
export const isAuditableSource = (name) => {
  const isKnownSource = isSourceFile(name, { includeTests: true });
  const isExcluded = name.includes('.min.') || name.endsWith('.d.ts');
  const isRegistered = !isExcluded && Boolean(getLanguageByExtension(path.extname(name)));
  return isKnownSource || isRegistered;
};
