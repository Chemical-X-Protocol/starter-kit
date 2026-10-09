// `chemx test` at a monorepo root: targets, --changed and --related run in their owning
// packages (each with its own runner and config) and the statuses combine; --all-packages runs
// every package; anything else runs the root package's own suite (apps own theirs).
import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from './result-status.js';
import { owningPackage } from './workspace.js';
import { rootPackage, rootOnlyNote, changedPackages, runPerPackage, changeNotes } from './workspace-run.js';

const toPosix = (p) => p.split(path.sep).join('/');

// A package with a package.json but no "test" script cannot be run by chemx; say so instead of guessing.
const hasTestScript = (pkg) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'package.json'), 'utf8'));
    return Boolean(manifest.scripts?.test);
  } catch { // chemx-allow: best-effort an unreadable manifest is treated as having no test script
    return false;
  }
};

// Groups paths by owning package; a path outside every package belongs to the root itself.
const groupByPackage = (workspace, files, cwd) => {
  const groups = new Map();
  for (const file of files) {
    const abs = path.resolve(cwd, file);
    const pkg = owningPackage(workspace.packages, abs) || rootPackage(workspace);
    const hasGroup = groups.has(pkg.dir);
    if (!hasGroup) groups.set(pkg.dir, { pkg, files: [] });
    groups.get(pkg.dir).files.push(toPosix(path.relative(pkg.dir, abs)) || '.');
  }
  return [...groups.values()].sort((a, b) => a.pkg.dir.localeCompare(b.pkg.dir));
};

const filterArgs = (filter) => (filter ? [`--filter=${filter}`] : []);

const noChangesReport = (detail) => ({ status: STATUS.INCONCLUSIVE, success: false, reason: 'NO_TESTS_RAN', detail, scope: 'workspace', packages: [] });

// scope: { targets, filter, changed, base, related, allPackages }. runInPackage(args, cwd)
// resolves to that package's own test report.
export const planWorkspaceTest = async (workspace, scope, runInPackage, cwd) => {
  const extraFlags = [...filterArgs(scope.filter), ...(scope.allowEmpty ? ['--allow-empty'] : [])];
  const isChangedScope = Boolean(scope.changed);
  if (isChangedScope) {
    const changes = changedPackages(workspace, scope.base);
    const hasChangeError = Boolean(!changes.ok);
    if (hasChangeError) return { ...noChangesReport(`cannot list changed files: ${changes.error}`), status: STATUS.INCONCLUSIVE };
    const baseArgs = ['--changed', ...(scope.base ? [`--base=${scope.base}`] : []), ...extraFlags];
    const rootFiles = changes.rootFiles.filter((file) => !changes.rootManifests.includes(file));
    const hasRootFiles = changes.rootFiles.length > 0;
    const candidates = hasRootFiles ? [rootPackage(workspace), ...changes.packages] : changes.packages;
    const runnable = candidates.filter(hasTestScript);
    const skipped = candidates.filter((pkg) => !hasTestScript(pkg));
    const units = runnable.map((pkg) => ({ pkg, args: baseArgs }));
    const skipNotes = skipped.map((pkg) => `${pkg.name} (${pkg.rel}) changed but has no test script; its tests were not run`);
    const notes = [...changeNotes({ ...changes, rootFiles: [] }), ...skipNotes];
    const hasRoutedRootFiles = rootFiles.length > 0;
    if (hasRoutedRootFiles) notes.push(`${rootFiles.length} changed root file(s) were routed to the root package's suite`);
    const extraStatuses = changes.rootManifests.length > 0 ? [STATUS.INCONCLUSIVE] : [];
    const hasNoUnits = units.length === 0;
    if (hasNoUnits) return { ...noChangesReport(`no changed files in any workspace package vs ${changes.base}`), notes, dependents: [] };
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir), { base: changes.base, dependents: changes.dependents, rootFiles: changes.rootFiles, notes, extraStatuses });
  }
  const paths = scope.related.length > 0 ? scope.related : scope.targets;
  const hasPaths = paths.length > 0;
  if (hasPaths) {
    const mode = scope.related.length > 0 ? ['--related'] : [];
    const groups = groupByPackage(workspace, paths, cwd);
    const units = groups.map(({ pkg, files }) => ({ pkg, args: [...mode, ...files, ...extraFlags] }));
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir));
  }
  const isAllPackages = Boolean(scope.allPackages);
  if (isAllPackages) {
    const units = workspace.packages.map((pkg) => ({ pkg, args: extraFlags }));
    const notes = ['the root test script was not run (it would cover the whole monorepo); target root files explicitly'];
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir), { notes });
  }
  const root = rootPackage(workspace);
  const notes = [rootOnlyNote(workspace, 'test script')];
  const hasRootTests = hasTestScript(root);
  if (!hasRootTests) return { ...noChangesReport(`the root package ${root.name} has no test script`), notes };
  return runPerPackage([{ pkg: root, args: extraFlags }], (unit) => runInPackage(unit.args, unit.pkg.dir), { notes });
};
