// Heal verify (engine doc, Heal: SAFETY SEQUENCE 6), run after the plan is written. Every stage is
// required and reports what it ran:
//   parse      every written file parses;
//   audit      no rule's violation count rises in a touched file, under the project config and under the
//              atomic-strict profile (all rules); a new module counts from zero, so the piece itself must
//              be clean;
//   typecheck  the piece in the checkJs-strict sandbox, and a diagnostic delta for touched files the
//              project's tsconfig typechecks (heal-typecheck.js); the verdict names the mode;
//   specs      the covering specs (reverse imports, depth 2) pass;
//   post       the group's member fp now occurs no more often than the piece exports it, and every
//              touched file stays under 500 lines.
import path from 'node:path';
import { parseSource } from '../source-parse.js';
import { auditCode } from '../audit/rules.js';
import { evaluateChanges, formatSites } from '../audit/gate-delta.js';
import { loadProjectConfig } from '../config/index.js';
import { getProfileDefaults } from '../config/profiles.js';
import { countLines } from '../line-count.js';
import { collectFileUnits } from './file-units.js';
import { typecheckPiece, scopedDiagnostics, introducedDiagnostics } from './heal-typecheck.js';
import { coveringSpecs } from './heal-specs.js';

const FILE_LINE_LIMIT = 500;
const PIECE_EXPORTS = 1;

const stageResult = (stage, ok, detail, extra = {}) => ({ stage, ok, detail, ...extra });

const parseStage = (root, files) => {
  const broken = files.filter((file) => !parseSource(file.after, path.join(root, file.file)).ok).map((file) => file.file);
  return stageResult('parse', broken.length === 0, broken.length === 0 ? `${files.length} files parse` : `does not parse: ${broken.join(', ')}`);
};

const auditUnder = (root, files, config, label) => evaluateChanges(files.map((file) => {
  const absolute = path.join(root, file.file);
  const before = file.before === null ? [] : auditCode(file.before, absolute, file.file, { config });
  return { file: file.file, before, after: auditCode(file.after, absolute, file.file, { config }) };
})).files.flatMap((entry) => formatSites(entry).map((site) => `${label}: ${site}`));

/** The audit stage alone (exported for the dry run, which reports it without writing). */
export const auditStage = (root, files) => {
  const introduced = [
    ...auditUnder(root, files, loadProjectConfig(root), 'project'),
    ...auditUnder(root, files, { rules: getProfileDefaults('atomic-strict') }, 'atomic-strict')
  ];
  const isClean = introduced.length === 0;
  return stageResult('audit', isClean, isClean ? `0 introduced violations in ${files.length} files (project config and atomic-strict)` : `${introduced.length} introduced: ${introduced.slice(0, 5).join('; ')}`, { introduced });
};

const typecheckStage = async (root, plan, baseline, options) => {
  const piece = await typecheckPiece(plan.pieceText, plan.module, { checkerRoot: options.checkerRoot ?? root });
  const covered = baseline?.covered ?? [];
  const hasScoped = covered.length > 0 && !baseline.error;
  const after = hasScoped ? await scopedDiagnostics(root, covered, { checkerRoot: options.checkerRoot ?? root }) : null;
  const introduced = hasScoped && !after.error ? introducedDiagnostics(baseline.diagnostics, after.diagnostics) : [];
  const scopedDetail = hasScoped ? `scoped: ${after.error ?? `${introduced.length} introduced diagnostics in ${covered.length} files`}` : `scoped: not run (${baseline?.error ?? 'no project tsconfig typechecks the touched files'})`;
  const isOk = piece.ok && introduced.length === 0 && !after?.error;
  return stageResult('typecheck', isOk, `sandbox: ${piece.status} (${piece.detail}); ${scopedDetail}`, { modes: { sandbox: piece.status, scoped: hasScoped ? 'ran' : 'not-run' }, introduced });
};

// A failing run is compared with the same specs on the files before the edit (options.baselineSpecs
// restores them, runs the specs and re-applies the edit): only failures the edit introduced count. A run
// whose failing tests cannot be named fails outright.
const introducedFailures = async (run, specs, options) => {
  const canCompare = Array.isArray(run.failures) && run.failures.length > 0 && typeof options.baselineSpecs === 'function';
  if (!canCompare) return { introduced: null, preExisting: [] };
  const before = await options.baselineSpecs(specs);
  const isComparable = Array.isArray(before.failures);
  if (!isComparable) return { introduced: null, preExisting: [] };
  return { introduced: run.failures.filter((name) => !before.failures.includes(name)), preExisting: run.failures.filter((name) => before.failures.includes(name)) };
};

const specsDetail = (count, run, compared) => {
  const hasPreExisting = compared.preExisting.length > 0;
  const preNote = hasPreExisting ? `; ${compared.preExisting.length} failing test(s) fail the same way before the edit: ${compared.preExisting.slice(0, 3).join('; ')}` : '';
  const verdict = run.ok ? 'pass' : `fail${compared.introduced ? ` (${compared.introduced.length} introduced)` : ''}`;
  return `${count} covering specs ${verdict}${preNote}`;
};

const specsStage = async (root, plan, options) => {
  const found = coveringSpecs(root, plan.files.map((file) => file.file), { depth: options.specDepth ?? 2, direct: options.directSpecs ?? [] });
  const hasSpecs = found.specs.length > 0;
  const openNote = found.open.length > 0 ? `; loads the graph cannot pin in ${found.open.join(', ')} (not expanded)` : '';
  if (!hasSpecs) return stageResult('specs', true, `no covering specs found (reverse imports, depth ${options.specDepth ?? 2})${openNote}`, { specs: [] });
  const run = options.runSpecs(root, found.specs);
  const compared = run.ok ? { introduced: [], preExisting: [] } : await introducedFailures(run, found.specs, options);
  const isOk = run.ok || (Array.isArray(compared.introduced) && compared.introduced.length === 0);
  return stageResult('specs', isOk, `${specsDetail(found.specs.length, run, compared)}${openNote}`, { specs: found.specs, output: run.output, introduced: compared.introduced, preExisting: compared.preExisting });
};

/** The post-condition alone: { ok, count, limit, longFiles }. */
export const postCondition = (plan, memberFps) => {
  const wanted = new Set(memberFps);
  const count = plan.files.reduce((sum, file) => sum + collectFileUnits(file.file, file.after).units.filter((unit) => wanted.has(unit.fp2)).length, 0);
  const longFiles = plan.files.filter((file) => countLines(file.after) > FILE_LINE_LIMIT).map((file) => file.file);
  return { ok: count <= PIECE_EXPORTS && longFiles.length === 0, count, limit: PIECE_EXPORTS, longFiles };
};

const postStage = (plan, memberFps) => {
  const post = postCondition(plan, memberFps);
  const longNote = post.longFiles.length > 0 ? `; over ${FILE_LINE_LIMIT} lines: ${post.longFiles.join(', ')}` : '';
  return stageResult('post', post.ok, `member fp occurs ${post.count} time(s) after the heal (limit ${post.limit})${longNote}`, { count: post.count });
};

/**
 * Runs the stages in order and stops at the first failure. options: { runSpecs(root, specs) -> { ok,
 * output, failures }, baselineSpecs(specs) -> same on the before files, checkerRoot, specDepth,
 * directSpecs }. baseline: { covered, diagnostics, error } from
 * scopedBaseline before the write. Returns { ok, stage (failed stage or null), stages }.
 */
export const verifyHeal = async ({ root, plan, memberFps, baseline, options }) => {
  const stages = [];
  const steps = [
    () => parseStage(root, plan.files),
    () => auditStage(root, plan.files),
    () => typecheckStage(root, plan, baseline, options),
    () => specsStage(root, plan, options),
    () => postStage(plan, memberFps)
  ];
  for (const step of steps) {
    const result = await step();
    stages.push(result);
    const isFailed = !result.ok;
    if (isFailed) return { ok: false, stage: result.stage, stages };
  }
  return { ok: true, stage: null, stages };
};

/** Typecheck baseline taken before the write: the covered files and their current diagnostics. */
export const scopedBaseline = async (root, coverage, options = {}) => {
  const hasCovered = coverage.covered.length > 0;
  if (!hasCovered) return { covered: [], diagnostics: [], error: null };
  const result = await scopedDiagnostics(root, coverage.covered, { checkerRoot: options.checkerRoot ?? root });
  return { covered: coverage.covered, diagnostics: result.diagnostics ?? [], error: result.error ?? null };
};
