// `chemx verify --changed`: the audit covers only the changed source files and the tests only
// the affected specs; typecheck stays whole-project (types cross every file) and says so.
import path from 'node:path';
import { listChangedFiles } from './test-changes.js';
import { isSourceFilePath } from './audit-preflight-git.js';
import { formatSites } from './audit/gate-delta.js';
import { ANSI } from './theme.js';
import { STATUS } from './result-status.js';
import { changedPackages, runPerPackage, changeNotes, rootOrAllPackages } from './workspace-run.js';

// Returns { ok, base, files } (root-relative source files that still exist) or { ok: false, error }.
export const resolveVerifyChanges = (root, base = null) => {
  const listing = listChangedFiles(root, { base });
  const isListingFailed = !listing.ok;
  if (isListingFailed) return { ok: false, error: listing.error };
  const files = listing.files.filter((f) => f.status !== 'D' && isSourceFilePath(f.path)).map((f) => f.path);
  return { ok: true, base: listing.base, files };
};

// The rising rules of a failed base delta under its step line: one `RULE@file:line [SEVERITY]` per new hazard.
export const formatDeltaFailure = (delta) => {
  const lines = delta.baseMissing ? [delta.error] : delta.files.flatMap(formatSites);
  return lines.map((line) => `      ${ANSI.RED}${line}${ANSI.RESET}\n`).join('');
};

export const changedAuditOptions = (root, changes) => ({ fileList: changes.files.map((file) => path.join(root, file)) });

export const testArgsFor = (changes, base) => (changes ? ['--changed', ...(base ? [`--base=${base}`] : [])] : []);

// verify at a monorepo root: --changed verifies each package that owns a changed file,
// --all-packages verifies every package, anything else is refused with the package list.
// runInPackage(pkg, args) resolves to that package's own verify summary.
export const verifyWorkspace = async (workspace, { changed, base, allPackages }, runInPackage) => {
  if (!changed) return rootOrAllPackages(workspace, 'verify', allPackages, (pkg) => runInPackage(pkg, []));
  const changes = changedPackages(workspace, base);
  const isChangesFailed = !changes.ok;
  if (isChangesFailed) return { status: STATUS.INCONCLUSIVE, success: false, reason: 'NO_CHANGES', error: `cannot list changed files: ${changes.error}`, packages: [] };
  const args = testArgsFor(changes, base);
  const extraStatuses = changes.rootManifests.length > 0 || changes.packages.length === 0 ? [STATUS.INCONCLUSIVE] : [];
  const units = changes.packages.map((pkg) => ({ pkg, args }));
  return runPerPackage(units, (unit) => runInPackage(unit.pkg, unit.args), { base: changes.base, dependents: changes.dependents, rootFiles: changes.rootFiles, notes: changeNotes(changes), extraStatuses });
};

// The gates a package's verify ran: a repo with its own runner has php -l and no typecheck (task #6770).
const GATES = { package: ['audit', 'typecheck', 'tests'], harness: ['phpLint', 'tests', 'audit'] };

export const formatVerifyLine = (entry) => {
  const gates = entry.phpLint ? GATES.harness : GATES.package;
  const steps = gates.map((step) => `${step} ${entry[step]?.status ?? '-'}`).join(', ');
  const icon = entry.status === STATUS.PASS ? `${ANSI.LIME}✔` : `${ANSI.RED}✖`;
  const excluded = Array.isArray(entry.scope?.excluded) ? entry.scope.excluded : [];
  const scopeLine = excluded.length > 0 ? `    ${ANSI.DIM}audited ${entry.scope.dir}/; not audited: ${excluded.join(", ")} (--all-packages runs their own audits)${ANSI.RESET}\n` : "";
  return `  ${icon}${ANSI.RESET} ${entry.status} ${ANSI.DIM}(${steps})${ANSI.RESET}\n${scopeLine}`;
};
