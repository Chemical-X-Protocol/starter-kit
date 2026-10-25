// The micro-check of one file: the payload `chemx check` builds and the text it prints. `chemx lint
// <paths>` reuses both, so a hazard looks the same whichever command found it.
import { ANSI } from './theme.js';
import { auditFileDetailed } from './audit-scan.js';
import { inconclusiveReason } from './audit/inconclusive.js';

/** The audit options for `check`: the config when given, and `fast` (AST rules skipped, so PHP is inconclusive). */
const checkAuditOptions = (config, isFast) => ({ ...(config ? { config } : {}), ...(isFast ? { fast: true } : {}) });

/** options.config: a loaded project config (e.g. with --profile applied); defaults to the cwd's config. */
export const checkFilePayload = (absPath, relPath, { config = null, isFast = false } = {}) => {
  const startTime = Date.now();
  const { violations, coverage } = auditFileDetailed(absPath, relPath, checkAuditOptions(config, isFast));
  const inconclusive = inconclusiveReason(coverage);
  const isInconclusive = inconclusive !== null;
  const criticalCount = violations.filter((v) => v.severity === 'CRITICAL').length;
  const highMedCount = violations.filter((v) => ['HIGH', 'MEDIUM'].includes(v.severity)).length;
  const isClean = violations.length === 0 && !isInconclusive;
  return {
    file: relPath,
    isClean,
    ...(isInconclusive ? { inconclusive } : {}),
    durationMs: Date.now() - startTime,
    violationsCount: violations.length,
    criticalCount,
    highMedCount,
    violations
  };
};

const hazardLines = (v) => {
  const color = v.severity === 'CRITICAL' ? ANSI.RED : ANSI.GOLD;
  const lines = [
    `  ${color}[${v.severity}]${ANSI.RESET} Line ${v.line}: ${v.rule}`,
    `    ${ANSI.DIM}Hazard: ${v.hazard}${ANSI.RESET}`
  ];
  const hasDirective = Boolean(v.directive);
  if (hasDirective) lines.push(`    ${ANSI.CYAN}Directive: ${v.directive}${ANSI.RESET}`);
  return lines;
};

/** The text `chemx check` prints for one payload: the Crystalline line when clean, else header, counts and each hazard. */
export const formatCheckText = (payload) => {
  const { file, isClean, inconclusive, durationMs, criticalCount, highMedCount, violations } = payload;
  if (isClean) return `\n${ANSI.BOLD}${ANSI.LIME}✔ Crystalline:${ANSI.RESET} ${file} ${ANSI.DIM}(0 hazards, ${durationMs}ms)${ANSI.RESET}\n\n`;
  const lines = [`\n${ANSI.BOLD}${ANSI.GOLD}Chemical X Micro-Check:${ANSI.RESET} ${ANSI.BOLD}${file}${ANSI.RESET} ${ANSI.DIM}(${durationMs}ms)${ANSI.RESET}`];
  const isInconclusive = Boolean(inconclusive);
  if (isInconclusive) lines.push(`  ${ANSI.GOLD}inconclusive: ${inconclusive}${ANSI.RESET} ${ANSI.DIM}(the AST rules did not run; a clean result is not claimed)${ANSI.RESET}`);
  lines.push(`  ${ANSI.RED}💥 ${criticalCount} Critical${ANSI.RESET} | ${ANSI.GOLD}🔥 ${highMedCount} High/Med${ANSI.RESET}`, '');
  for (const v of violations) lines.push(...hazardLines(v));
  return `${lines.join('\n')}\n\n`;
};
