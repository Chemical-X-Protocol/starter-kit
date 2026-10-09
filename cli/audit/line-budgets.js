/**
 * The one line-budget source of truth (AGENTS.md 1.A, 1.B, 1.C, 2.A), consumed by
 * the audit rules, the audit metrics and the docs spec. Profiles pick the numbers;
 * nothing else hard-codes a line limit.
 *
 * - Any file: monolith warning above 500 lines (MEDIUM), HIGH at 1,000, CRITICAL at 2,000.
 * - Molecule capsules: the profile's molecule budget. Under pragmatic and loose it is a
 *   soft warning that only fires when the file also has high cyclomatic complexity;
 *   under atomic-strict it is a hard cap.
 * - View templates (views/pages entry files with markup): 200 lines, CRITICAL at 500.
 * - Type files follow the file budget; there is no separate type-file cap (2.A).
 */
import path from 'node:path';

export const FILE_BUDGET = Object.freeze({ warn: 500, high: 1000, critical: 2000 });
export const VIEW_TEMPLATE_BUDGET = Object.freeze({ warn: 200, critical: 500 });

// Config keys from before profiles; nothing reads them, so the installer drops them on save.
export const LEGACY_LINE_BUDGET_KEYS = Object.freeze(['maxLineCount', 'maxMoleculeLineCount']);

/**
 * File size class with the LINE_BUDGET_FILE boundaries: 'warning' above warn (MEDIUM),
 * 'severe' from high (HIGH), 'extreme' from critical (CRITICAL), else null. Reporters,
 * history, roadmap and the navigator classify monoliths only through this.
 */
export const classifyFileSize = (lineCount, budget = FILE_BUDGET) => {
  const isExtreme = lineCount >= budget.critical;
  const isSevere = lineCount >= budget.high;
  const isWarning = lineCount > budget.warn;
  if (isExtreme) return 'extreme';
  if (isSevere) return 'severe';
  return isWarning ? 'warning' : null;
};

const SIZE_RANK = Object.freeze({ warning: 1, severe: 2, extreme: 3 });

/** True when the file is at least the given size class ('warning' means any monolith). */
export const isAtLeastSize = (lineCount, sizeClass) => (SIZE_RANK[classifyFileSize(lineCount)] ?? 0) >= SIZE_RANK[sizeClass];

/** Hotspot predicate for one exact size class: hotspots.filter(hasSizeClass('severe')). */
export const hasSizeClass = (sizeClass) => (hotspot) => classifyFileSize(hotspot.lineCount) === sizeClass;

/** Hotspot predicate for any monolith (the file rule fires). */
export const isMonolithHotspot = (hotspot) => Boolean(hotspot.isMonolith) || classifyFileSize(hotspot.lineCount) !== null;

const formatCount = (n) => n.toLocaleString('en-US');

/** Human labels derived from FILE_BUDGET, e.g. { warning: '> 500', severe: '>= 1,000', ... }. */
export const SIZE_LABELS = Object.freeze({
  warnLimit: formatCount(FILE_BUDGET.warn),
  warning: `> ${formatCount(FILE_BUDGET.warn)}`,
  warningRange: `${formatCount(FILE_BUDGET.warn + 1)} to ${formatCount(FILE_BUDGET.high - 1)}`,
  severe: `>= ${formatCount(FILE_BUDGET.high)}`,
  severeRange: `${formatCount(FILE_BUDGET.high)} to ${formatCount(FILE_BUDGET.critical - 1)}`,
  extreme: `>= ${formatCount(FILE_BUDGET.critical)}`
});

const MOLECULE_BUDGET_BY_PROFILE = Object.freeze({ pragmatic: 250, 'atomic-strict': 100, loose: 500 });
const DEFAULT_PROFILE = 'pragmatic';

const DEFAULT_TIER_PATTERNS = Object.freeze({
  molecule: [/(?:^|[\\/])molecules[\\/]/, /(?:^|[\\/])m-[^\\/]+/],
  view: [/(?:^|[\\/])views[\\/]/, /(?:^|[\\/])pages[\\/]/, /View\.[tj]sx?$/]
});
const VIEW_MARKUP_EXTENSIONS = new Set(['.vue', '.tsx', '.jsx', '.svelte']);

/** Lines as `wc -l` counts them: a trailing newline does not open a new line. */
export const countLines = (content) => {
  if (!content) return 0;
  const parts = content.split('\n');
  const hasTrailingNewline = content.endsWith('\n');
  return hasTrailingNewline ? parts.length - 1 : parts.length;
};

const resolveProfileName = (config = {}) => {
  const isStrict = config.enforceFileLength === true;
  if (isStrict) return 'atomic-strict';
  return config.profile || DEFAULT_PROFILE;
};

/** A positive integer molecule warning from config, or null ('abc', 0 and -5 are ignored). */
const parseMoleculeWarning = (value) => {
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
};

/**
 * enforce-file-length means atomic-strict: its 100 wins over the pragmatic default warning
 * that loaded rules always carry. Any budget is capped at the file bound (FILE_BUDGET.warn).
 */
export const getLineBudgets = (config = {}) => {
  const profile = resolveProfileName(config);
  const profileBudget = MOLECULE_BUDGET_BY_PROFILE[profile] ?? MOLECULE_BUDGET_BY_PROFILE[DEFAULT_PROFILE];
  const isEnforced = config.enforceFileLength === true;
  const configured = isEnforced ? null : parseMoleculeWarning(config.maxLineCountWarning);
  const moleculeBudget = Math.min(configured ?? profileBudget, FILE_BUDGET.warn);
  const isMoleculeHardCap = profile === 'atomic-strict';
  return { profile, file: FILE_BUDGET, molecule: moleculeBudget, isMoleculeHardCap, viewTemplate: VIEW_TEMPLATE_BUDGET };
};

/**
 * The whole-file line limit a path is held to: the profile's molecule budget for
 * molecule capsules, otherwise the file budget's warning line. Patcher receipts and
 * the UI's over-budget badges read this instead of hard-coding 100/500.
 */
export const lineLimitFor = (relativePath, config = {}) => {
  const budgets = getLineBudgets(config);
  const isMolecule = resolveFileTier(relativePath, config) === 'molecule';
  return isMolecule ? budgets.molecule : budgets.file.warn;
};

/** One-line policy text for prompts and banners, derived from the budgets above. */
export const LINE_BUDGET_SUMMARY = `Max ${FILE_BUDGET.warn} lines/file; molecule capsules ${MOLECULE_BUDGET_BY_PROFILE.pragmatic} lines (pragmatic) or ${MOLECULE_BUDGET_BY_PROFILE['atomic-strict']} (atomic-strict)`;

const GLOB_TOKENS = [
  ['**/', '(?:.*/)?'],
  ['**', '.*'],
  ['*', '[^/]*'],
  ['?', '[^/]']
];

/** Minimal glob: `**` spans directories, `*` and `?` stay within one segment. */
export const globToRegExp = (glob) => {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const token = GLOB_TOKENS.find(([raw]) => glob.startsWith(raw, i));
    if (token) {
      pattern += token[1];
      i += token[0].length;
    } else {
      pattern += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`(?:^|/)${pattern}$`);
};

const matchesConfiguredTier = (relPath, globs = []) => globs.some((glob) => globToRegExp(glob).test(relPath));

/** 'molecule' | 'view' | null. `.chemxrc` `tiers: { molecule: [globs], view: [globs] }` extends the defaults. */
export const resolveFileTier = (relativePath, config = {}) => {
  const normalized = relativePath.split(path.sep).join('/');
  const baseName = path.basename(normalized);
  const tiers = config.tiers || {};
  const isMolecule = DEFAULT_TIER_PATTERNS.molecule.some((re) => re.test(normalized)) ||
    baseName.startsWith('m-') || matchesConfiguredTier(normalized, tiers.molecule);
  if (isMolecule) return 'molecule';
  const isView = DEFAULT_TIER_PATTERNS.view.some((re) => re.test(normalized)) || matchesConfiguredTier(normalized, tiers.view);
  return isView ? 'view' : null;
};

/** View budgets apply to markup-bearing view entries, never to .ts/.js controllers. */
export const isViewMarkupFile = (relativePath) => VIEW_MARKUP_EXTENSIONS.has(path.extname(relativePath));
