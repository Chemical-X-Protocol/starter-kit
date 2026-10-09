// `chemx verify --changed`: the audit covers only the changed source files and the tests only
// the affected specs; typecheck stays whole-project (types cross every file) and says so.
import path from 'node:path';
import { listChangedFiles } from './test-changes.js';
import { isSourceFilePath } from './audit-preflight-git.js';
import { ANSI } from './theme.js';
import { STATUS } from './result-status.js';
import { changedPackages, runPerPackage, changeNotes, allPackagesOrRefuse } from './workspace-run.js';

// Returns { ok, base, files } (root-relative source files that still exist) or { ok: false, error }.
export const resolveVerifyChanges = (root, base = null) => {
  const listing = listChangedFiles(root, { base });
  const isListingFailed = !listing.ok;
  if (isListingFailed) return { ok: false, error: listing.error };
  const files = listing.files.filter((f) => f.status !== 'D' && isSourceFilePath(f.path)).map((f) => f.path);
  return { ok: true, base: listing.base, files };
};

export const changedAuditOptions = (root, changes) => ({ fileList: changes.files.map((file) => path.join(root, file)) });

export const testArgsFor = (changes, base) => (changes ? ['--changed', ...(base ? [`--base=${base}`] : [])] : []);

// verify at a monorepo root: --changed verifies each package that owns a changed file,
// --all-packages verifies every package, anything else is refused with the package list.
// runInPackage(pkg, args) resolves to that package's own verify summary.
export const verifyWorkspace = async (workspace, { changed, base, allPackages }, runInPackage) => {
  if (!changed) return allPackagesOrRefuse(workspace, 'verify', allPackages, 'use --dir=<package>, use --changed', (pkg) => runInPackage(pkg, []));
  const changes = changedPackages(workspace, base);
  const isChangesFailed = !changes.ok;
  if (isChangesFailed) return { status: STATUS.INCONCLUSIVE, success: false, reason: 'NO_CHANGES', error: `cannot list changed files: ${changes.error}`, packages: [] };
  const args = testArgsFor(changes, base);
  const extraStatuses = changes.rootManifests.length > 0 || changes.packages.length === 0 ? [STATUS.INCONCLUSIVE] : [];
  const units = changes.packages.map((pkg) => ({ pkg, args }));
  return runPerPackage(units, (unit) => runInPackage(unit.pkg, unit.args), { base: changes.base, dependents: changes.dependents, rootFiles: changes.rootFiles, notes: changeNotes(changes), extraStatuses });
};

export const formatVerifyLine = (entry) => {
  const steps = ['audit', 'typecheck', 'tests'].map((step) => `${step} ${entry[step]?.status ?? '-'}`).join(', ');
  const icon = entry.status === STATUS.PASS ? `${ANSI.LIME}✔` : `${ANSI.RED}✖`;
  return `  ${icon}${ANSI.RESET} ${entry.status} ${ANSI.DIM}(${steps})${ANSI.RESET}\n`;
};
