// Per-package fan-out for commands started at a workspace (monorepo) root. A root run with no
// target is refused with the package list (unless --all-packages): running every package's
// tests, types or audit at once is what made the whole monorepo too big to check.
import path from 'node:path';
import { findProjectRoot } from './build/detector.js';
import { ANSI } from './theme.js';
import { STATUS, combineStatuses } from './result-status.js';
import { readWorkspaceGlobs, listWorkspacePackages, owningPackage, workspaceDependents } from './workspace.js';
import { listChangedFiles } from './test-changes.js';
import { formatAgentJson } from './agent-json.js';
import { toExitCode } from './result-status.js';

export const MONOREPO_ROOT = 'MONOREPO_ROOT';
const MANIFEST = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|\.npmrc|tsconfig[^/]*\.json)$/;

// The workspace whose root is exactly `dir` (with at least one package), or null.
export const workspaceAt = (dir) => {
  const globs = readWorkspaceGlobs(dir);
  if (!globs) return null;
  const packages = listWorkspacePackages(dir, globs);
  return packages.length > 0 ? { root: dir, packages } : null;
};

const packageList = (packages) => packages.map((p) => ({ package: p.name, dir: p.rel }));

export const refusalReport = (command, workspace, scopeHint) => ({
  status: STATUS.INCONCLUSIVE, success: false, reason: MONOREPO_ROOT, exitCode: 3, command,
  executionError: `chemx ${command} at a monorepo root would cover all ${workspace.packages.length} packages. Run it inside a package, ${scopeHint}, or pass --all-packages.`,
  packages: packageList(workspace.packages)
});

// Groups changed files (vs HEAD or base) by owning package. Files outside every package are
// returned as rootFiles; a root manifest or lockfile among them can affect every package.
export const changedPackages = (workspace, base) => {
  const listing = listChangedFiles(workspace.root, { base });
  if (!listing.ok) return { ok: false, error: listing.error };
  const owners = new Map();
  const rootFiles = [];
  for (const file of listing.files) {
    const owner = owningPackage(workspace.packages, path.join(workspace.root, file.path));
    if (!owner) rootFiles.push(file.path);
    else owners.set(owner.rel, owner);
  }
  const packages = [...owners.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  const rootManifests = rootFiles.filter((file) => MANIFEST.test(file));
  const dependents = workspaceDependents(workspace.packages, packages.map((p) => p.name));
  return { ok: true, base: listing.base, packages, rootFiles, rootManifests, dependents };
};

// units: [{ pkg: { name, rel, dir }, args }]; runOne(unit) resolves to a report with .status.
// Returns { status, success, scope: 'workspace', packages: [{ package, dir, ...report }], ...extra }.
export const runPerPackage = async (units, runOne, extra = {}) => {
  const packages = [];
  for (const unit of units) {
    const report = await runOne(unit);
    packages.push({ package: unit.pkg.name, dir: unit.pkg.rel || '.', ...report });
  }
  const statuses = [...packages.map((p) => p.status), ...(extra.extraStatuses || [])];
  const { extraStatuses, ...rest } = extra;
  const status = combineStatuses(statuses);
  return { status, success: status === STATUS.PASS, scope: 'workspace', packages, ...rest };
};

// Text: each package's own report under a header, then the notes that keep a subset honest.
export const formatWorkspaceReport = (combined, formatOne) => {
  const out = [];
  for (const entry of combined.packages) {
    out.push(`\n  ${ANSI.BOLD}${ANSI.CYAN}${entry.package}${ANSI.RESET} ${ANSI.DIM}(${entry.dir})${ANSI.RESET}\n`);
    out.push(formatOne(entry));
  }
  for (const note of combined.notes || []) out.push(`  ${ANSI.YELLOW}!${ANSI.RESET} ${note}\n`);
  out.push(`\n  ${ANSI.BOLD}Workspace: ${combined.packages.length} package(s), ${combined.status}${ANSI.RESET}\n`);
  return out.join('');
};

export const formatRefusal = (report) => {
  const lines = report.packages.map((p) => `    ${p.package} ${ANSI.DIM}${p.dir}${ANSI.RESET}`);
  return `  ${ANSI.YELLOW}?${ANSI.RESET} ${ANSI.BOLD}${report.executionError}${ANSI.RESET}\n${lines.join('\n')}\n`;
};

// Notes for a --changed fan-out: dependents that were not run and root files outside packages.
export const changeNotes = (changes) => {
  const notes = [];
  const hasDependents = changes.dependents.length > 0;
  if (hasDependents) notes.push(`not run: ${changes.dependents.map((d) => `${d.package} (depends on ${d.via})`).join(', ')}; run them with --all-packages or inside each package`);
  const hasRootFiles = changes.rootFiles.length > 0;
  if (hasRootFiles) notes.push(`outside every package: ${changes.rootFiles.slice(0, 5).join(', ')}${changes.rootFiles.length > 5 ? ', ...' : ''}`);
  const hasRootManifests = changes.rootManifests.length > 0;
  if (hasRootManifests) notes.push(`${changes.rootManifests.join(', ')} changed at the root: every package may be affected; rerun with --all-packages`);
  return notes;
};

// Prints a workspace result (refusal or fan-out) the way the command prints its own reports.
export const emitWorkspace = (report, { isJson, isCli, shouldPrint }, formatOne) => {
  const isRefusal = report.reason === MONOREPO_ROOT;
  const text = isRefusal ? formatRefusal(report) : formatWorkspaceReport(report, formatOne);
  if (shouldPrint) process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : text);
  if (isCli) process.exit(toExitCode(report.status));
  return report;
};

// --all-packages runs `runInPackage(pkg)` in every package; without it the root run is refused.
export const allPackagesOrRefuse = async (workspace, command, allPackages, scopeHint, runInPackage) => {
  if (!allPackages) return refusalReport(command, workspace, scopeHint);
  const units = workspace.packages.map((pkg) => ({ pkg, args: [] }));
  return runPerPackage(units, (unit) => runInPackage(unit.pkg));
};

// `chemx audit` at a monorepo root with no dir or scope would index and audit every package.
// Prints the refusal with the package list and sets exit code 3; --all-packages opts in.
export const refuseMonorepoRootAudit = (posDir, rawArgs, cwd = process.cwd()) => {
  const hasScope = Boolean(posDir) || rawArgs.some((arg) => /^--(?:dir=|all-packages$|git$|changed$)/.test(arg));
  const workspace = hasScope ? null : workspaceAt(findProjectRoot(cwd));
  if (!workspace) return false;
  const report = refusalReport('audit', workspace, 'pass --dir=<package>, use --changed');
  const isJson = rawArgs.includes('--json');
  process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : formatRefusal(report));
  process.exitCode = toExitCode(report.status);
  return true;
};
