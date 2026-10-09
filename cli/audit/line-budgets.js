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

export const getLineBudgets = (config = {}) => {
  const profile = resolveProfileName(config);
  const moleculeBudget = config.maxLineCountWarning ?? MOLECULE_BUDGET_BY_PROFILE[profile] ?? MOLECULE_BUDGET_BY_PROFILE[DEFAULT_PROFILE];
  const isMoleculeHardCap = profile === 'atomic-strict';
  return { profile, file: FILE_BUDGET, molecule: moleculeBudget, isMoleculeHardCap, viewTemplate: VIEW_TEMPLATE_BUDGET };
};

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
