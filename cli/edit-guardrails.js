/**
 * Post-edit architecture guardrails, evaluated on the new content in memory
 * (so a dry run audits the patched text, not the file still on disk).
 */
import path from 'node:path';
import { auditCode } from './audit/rules.js';
import { isSourceFile } from './languages.js';
import { countLines } from './line-count.js';

const RAW_DOM_REGEX = /<\s*(button|input|textarea|select)\b[^>]*>/i;
const isSevere = (severity) => (v) => v.severity === severity;

const isMoleculePath = (relPath) => {
  const baseName = path.basename(relPath);
  return relPath.includes('molecules') || relPath.includes('/m-') || baseName.startsWith('m-');
};

const rawDomViolation = (relPath, content) => {
  const match = content.match(RAW_DOM_REGEX);
  const hasRawDom = Boolean(match);
  if (!hasRawDom) return null;
  const tag = match[1];
  return {
    filePath: relPath,
    line: content.slice(0, match.index).split('\n').length,
    hazard: `Raw <${tag}> tag detected in molecule capsule. Only atoms may contain raw DOM elements per Directive 1.G.`,
    rule: 'ZERO_RAW_DOM_MOLECULE',
    severity: 'CRITICAL',
    pillar: 'Molecular Architecture',
    directive: `Encapsulate <${tag}> inside a foundational atom capsule (e.g. AtomButton, AtomInput).`
  };
};

const auditInMemory = (absPath, relPath, content) => {
  const isAuditable = isSourceFile(path.basename(absPath), { includeTests: true });
  if (!isAuditable) return [];
  try {
    return auditCode(content, absPath, relPath);
  } catch {
    return [];
  }
};

/**
 * @param {object} params { absPath, relPath, content, skipCheck }
 * @returns {{ lineBudget: object, isClean: boolean, violationsCount: number, criticalCount: number, highCount: number, violations: object[] }}
 */
export const evaluateGuardrails = ({ absPath, relPath, content, skipCheck = false }) => {
  const lines = countLines(content);
  const isMolecule = isMoleculePath(relPath);
  const limit = isMolecule ? 100 : 500;
  const isBudgetExceeded = lines > limit;
  const lineBudget = {
    lines,
    limit,
    passed: !isBudgetExceeded,
    warning: isBudgetExceeded
      ? `File exceeds ${limit}-line limit (${lines}L). Split into smaller single-purpose units per Directive 1.A.`
      : null
  };

  const violations = skipCheck ? [] : auditInMemory(absPath, relPath, content);
  const domViolation = !skipCheck && isMolecule ? rawDomViolation(relPath, content) : null;
  const hasDomViolation = Boolean(domViolation);
  if (hasDomViolation) violations.push(domViolation);

  return {
    lineBudget,
    isClean: violations.length === 0 && !isBudgetExceeded,
    violationsCount: violations.length,
    criticalCount: violations.filter(isSevere('CRITICAL')).length,
    highCount: violations.filter(isSevere('HIGH')).length,
    violations
  };
};
