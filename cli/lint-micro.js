// The micro-check half of `chemx lint <paths>`: the hazards `chemx check` would report for those
// paths (inline booleans, dispatch switches, silent catches), in check's own output, so one pass
// answers both. It is also the whole lint when there is no ESLint to run (K12, #6757).
import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';
import { discoverSourceFiles } from './audit-scan.js';
import { isAuditableSource } from './audit/inconclusive.js';
import { checkFilePayload, formatCheckText } from './check-report.js';

/** Most hazards the text view prints; the rest are counted. `--json` carries every one. */
export const MICRO_TEXT_LIMIT = 30;

/**
 * Paths (files or directories, relative to baseDir) to { files: [{ abs, rel }], missing }. A directory
 * contributes its source files (.gitignore honoured, tests skipped, as `chemx audit` scans it); a named
 * file that is not source (json, md, php before its audit lands) is returned in `skipped`; a path that
 * does not exist is returned in `missing`.
 */
export const expandLintTargets = (targets, baseDir) => {
  const found = new Map();
  const missing = [];
  const skipped = [];
  for (const target of targets) {
    const abs = path.resolve(baseDir, target);
    const stat = fs.statSync(abs, { throwIfNoEntry: false });
    if (!stat) {
      missing.push(target);
      continue;
    }
    const isDirectory = stat.isDirectory();
    const candidates = isDirectory ? discoverSourceFiles(abs, false) : [abs];
    for (const file of candidates) {
      const isSource = isAuditableSource(path.basename(file));
      if (isSource) found.set(file, { abs: file, rel: path.relative(baseDir, file) });
      else if (!isDirectory) skipped.push(target);
    }
  }
  return { files: [...found.values()], missing, skipped };
};

/** Runs check's audit on each file. options.config: a loaded project config (default: the cwd's). */
export const runMicroChecks = (files, { config = null } = {}) => {
  const startTime = Date.now();
  const payloads = files.map((file) => checkFilePayload(file.abs, file.rel, { config }));
  const failing = payloads.filter((payload) => !payload.isClean);
  return {
    checked: payloads.length,
    files: payloads.map((payload) => payload.file),
    failing,
    isClean: failing.length === 0,
    hazardCount: payloads.reduce((sum, p) => sum + p.violationsCount, 0),
    criticalCount: payloads.reduce((sum, p) => sum + p.criticalCount, 0),
    highMedCount: payloads.reduce((sum, p) => sum + p.highMedCount, 0),
    durationMs: Date.now() - startTime
  };
};

/** Every hazard as a { file, line, severity, ruleId, message } diagnostic row, for the --json report. */
export const microRows = (micro) => micro.failing.flatMap((payload) => payload.violations.map((v) => ({
  file: payload.file, line: v.line, severity: v.severity, ruleId: v.rule, message: v.hazard
})));

const cleanText = (micro) => {
  const isSingleFile = micro.checked === 1;
  if (isSingleFile) return formatCheckText({ file: micro.files[0], isClean: true, durationMs: micro.durationMs });
  return `  ${ANSI.LIME}✔ Crystalline:${ANSI.RESET} ${micro.checked} files ${ANSI.DIM}(0 hazards, ${micro.durationMs}ms)${ANSI.RESET}\n`;
};

/** check's text for each failing file, stopping at `limit` hazards with a count of what was left out. */
export const formatMicroText = (micro, limit = MICRO_TEXT_LIMIT) => {
  const hasNothingChecked = micro.checked === 0;
  if (hasNothingChecked) return '';
  if (micro.isClean) return cleanText(micro);
  let budget = limit;
  let cutHazards = 0;
  let cutFiles = 0;
  const blocks = [];
  for (const payload of micro.failing) {
    const shown = payload.violations.slice(0, budget);
    budget -= shown.length;
    const leftOut = payload.violations.length - shown.length;
    cutHazards += leftOut;
    const hasLeftOut = leftOut > 0;
    if (hasLeftOut) cutFiles += 1;
    const isFullyHidden = shown.length === 0 && hasLeftOut;
    if (!isFullyHidden) blocks.push(formatCheckText({ ...payload, violations: shown }));
  }
  const footer = cutHazards > 0 ? `  ${ANSI.DIM}...and ${cutHazards} more hazard(s) in ${cutFiles} file(s); chemx check <file> lists every one${ANSI.RESET}\n\n` : '';
  return blocks.join('') + footer;
};
