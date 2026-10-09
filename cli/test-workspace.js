// `chemx test` at a monorepo root: targets, --changed and --related run in their owning
// packages (each with its own runner and config) and the statuses combine; --all-packages runs
// every package; anything else is refused with the package list.
import path from 'node:path';
import { STATUS } from './result-status.js';
import { owningPackage } from './workspace.js';
import { refusalReport, changedPackages, runPerPackage, changeNotes } from './workspace-run.js';

const toPosix = (p) => p.split(path.sep).join('/');
const ROOT_PACKAGE = (root) => ({ name: '<root>', rel: '.', dir: root });

// Groups paths by owning package; a path outside every package belongs to the root itself.
const groupByPackage = (workspace, files, cwd) => {
  const groups = new Map();
  for (const file of files) {
    const abs = path.resolve(cwd, file);
    const pkg = owningPackage(workspace.packages, abs) || ROOT_PACKAGE(workspace.root);
    if (!groups.has(pkg.dir)) groups.set(pkg.dir, { pkg, files: [] });
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
  if (scope.changed) {
    const changes = changedPackages(workspace, scope.base);
    if (!changes.ok) return { ...noChangesReport(`cannot list changed files: ${changes.error}`), status: STATUS.INCONCLUSIVE };
    const baseArgs = ['--changed', ...(scope.base ? [`--base=${scope.base}`] : []), ...extraFlags];
    const units = changes.packages.map((pkg) => ({ pkg, args: baseArgs }));
    const notes = changeNotes(changes);
    const extraStatuses = changes.rootManifests.length > 0 ? [STATUS.INCONCLUSIVE] : [];
    if (units.length === 0) return { ...noChangesReport(`no changed files in any workspace package vs ${changes.base}`), notes, dependents: [] };
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir), { base: changes.base, dependents: changes.dependents, rootFiles: changes.rootFiles, notes, extraStatuses });
  }
  const paths = scope.related.length > 0 ? scope.related : scope.targets;
  if (paths.length > 0) {
    const mode = scope.related.length > 0 ? ['--related'] : [];
    const groups = groupByPackage(workspace, paths, cwd);
    const units = groups.map(({ pkg, files }) => ({ pkg, args: [...mode, ...files, ...extraFlags] }));
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir));
  }
  if (scope.allPackages) {
    const units = workspace.packages.map((pkg) => ({ pkg, args: extraFlags }));
    const notes = ['the root test script was not run (it would cover the whole monorepo); target root files explicitly'];
    return runPerPackage(units, (unit) => runInPackage(unit.args, unit.pkg.dir), { notes });
  }
  return refusalReport('test', workspace, 'pass paths inside packages, or use --changed');
};
