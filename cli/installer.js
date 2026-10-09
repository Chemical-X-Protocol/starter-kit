import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';
import { installAllMcpConfigs } from './mcp/installer.js';
import { writeFileSafely } from './mcp/installer-write.js';
import { addPackageScripts } from './mcp/installer-package.js';
import { runPillarsWizard } from './pillars-wizard.js';
import { readExistingProjectConfig } from './config/loader.js';
import { LEGACY_LINE_BUDGET_KEYS } from './audit/line-budgets.js';

export { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';
export { installAllMcpConfigs } from './mcp/installer.js';
export { readExistingProjectConfig } from './config/loader.js';

export const resolveGitHooksDir = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const gitPath = path.join(resolvedTarget, '.git');
  const hasGitEntry = fs.existsSync(gitPath);
  if (!hasGitEntry) return null;

  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return path.join(gitPath, 'hooks');
    }
    if (stat.isFile()) {
      const gitContent = fs.readFileSync(gitPath, 'utf-8');
      const match = gitContent.match(/gitdir:\s*(.+)/);
      if (!match) return null;

      const gitDir = path.resolve(resolvedTarget, match[1].trim());
      const commonDirFile = path.join(gitDir, 'commondir');
      const actualGitDir = fs.existsSync(commonDirFile)
        ? path.resolve(gitDir, fs.readFileSync(commonDirFile, 'utf-8').trim())
        : gitDir;

      return path.join(actualGitDir, 'hooks');
    }
  } catch {
    return null;
  }
  return null;
};

const HOOK_THRESHOLDS = /CONF_MIN_GRADE:-([^}]*)\}\}"[\s\S]*?CONF_MIN_SCORE:-([^}]*)\}\}"/;

/**
 * True only when a hook is byte-for-byte what chemx generates (for its own thresholds),
 * so replacing it loses nothing. A chemx hook the user edited is not "own" and gets a backup.
 */
export const isChemxHook = (text = '') => {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const thresholds = normalized.match(HOOK_THRESHOLDS);
  const hasThresholds = Boolean(thresholds);
  if (!hasThresholds) return false;
  return normalized === buildPreCommitHookScript(thresholds[1], thresholds[2]);
};

export const installPreCommitHook = (targetDir = '.', options = {}) => {
  const gitHooksDir = resolveGitHooksDir(targetDir);
  if (!gitHooksDir) {
    process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
    return false;
  }

  const isHooksDirMissing = !fs.existsSync(gitHooksDir);
  if (isHooksDirMissing) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
  }

  const hookPath = path.join(gitHooksDir, 'pre-commit');
  const { backupPath } = writeFileSafely(hookPath, buildPreCommitHookScript(options.minGrade, options.minScore), { isOwnContent: isChemxHook, preserveLineEndings: false });
  fs.chmodSync(hookPath, 0o755);
  const relativeHook = path.relative(path.resolve(targetDir), hookPath);
  const hasBackup = Boolean(backupPath);
  if (hasBackup) process.stdout.write(`  \x1b[33mℹ\x1b[0m Previous pre-commit hook saved as ${path.relative(path.resolve(targetDir), backupPath)}\n`);
  process.stdout.write(`  \x1b[32m✔\x1b[0m Installed git pre-commit hook: ${relativeHook} (chmod +x)\n`);
  ensurePackageScripts(targetDir);
  return true;
};

export const installGitHubWorkflow = (targetDir = '.', options = {}) => {
  const wfDir = path.resolve(targetDir, '.github', 'workflows');
  const isWorkflowDirMissing = !fs.existsSync(wfDir);
  if (isWorkflowDirMissing) fs.mkdirSync(wfDir, { recursive: true });
  const wfPath = path.join(wfDir, 'chemx-audit.yml');
  fs.writeFileSync(wfPath, buildGitHubWorkflowScript(options.minGrade, options.minScore), 'utf-8');
  process.stdout.write(`  \x1b[32m✔\x1b[0m Installed GitHub Actions CI workflow: .github/workflows/chemx-audit.yml\n`);
  return true;
};

export const saveProjectConfig = (targetDir = '.', config = {}) => {
  const chemxDir = path.resolve(targetDir, '.chemx');
  const isChemxDirMissing = !fs.existsSync(chemxDir);
  if (isChemxDirMissing) fs.mkdirSync(chemxDir, { recursive: true });
  fs.writeFileSync(path.join(chemxDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  process.stdout.write(`  \x1b[32m✔\x1b[0m Saved project settings to: .chemx/config.json\n`);
};

/** The installer's settings merged over the existing config, so pillars, profile and framework survive. */
export const buildInstallerProjectConfig = (opts = {}, existing = {}) => {
  const merged = { ...existing, minGrade: opts.minGrade, minScore: opts.minScore };
  for (const key of LEGACY_LINE_BUDGET_KEYS) delete merged[key];
  return merged;
};

/** Saves the merged config; a config that does not parse as an object is left untouched (returns false). */
export const saveInstallerProjectConfig = (targetDir = '.', opts = {}) => {
  const existing = readExistingProjectConfig(targetDir);
  const isUnreadable = existing === null;
  if (isUnreadable) {
    process.stdout.write('  \x1b[33m⚠\x1b[0m Kept .chemx/config.json unchanged: it does not parse as a JSON object, so minGrade and minScore were not saved. Fix it and re-run the installer.\n');
    return false;
  }
  saveProjectConfig(targetDir, buildInstallerProjectConfig(opts, existing));
  return true;
};

export const areGuardrailsInstalled = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const wfPath = path.join(resolvedTarget, '.github', 'workflows', 'chemx-audit.yml');
  const hasWf = fs.existsSync(wfPath);

  const hooksDir = resolveGitHooksDir(resolvedTarget);
  if (!hooksDir) {
    return hasWf;
  }

  const hookPath = path.join(hooksDir, 'pre-commit');
  const isHookFile = fs.statSync(hookPath, { throwIfNoEntry: false })?.isFile() ?? false;
  const hookContent = isHookFile ? fs.readFileSync(hookPath, 'utf-8') : '';
  const hasHook = hookContent.includes('Chemical X') || hookContent.includes('chemx');

  return hasWf && hasHook;
};

const QUERY_PACKAGE_NAMES = ['chemx', '@chemx/starter-kit'];

/** package.json parsed as an object, or null when it is missing, unreadable or not valid JSON. */
const readPackageJsonSafely = (pkgPath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const isObject = Boolean(parsed) && typeof parsed === 'object';
    return isObject ? parsed : null;
  } catch {
    return null;
  }
};

const isQueryPackageListed = (deps) => QUERY_PACKAGE_NAMES.some((name) => Boolean(deps?.[name]));

/**
 * True once "chemx q" can run here: package.json wires chemx in (a `chemx` script, the legacy `q`
 * script, or chemx as a dependency) AND the SQLite index (.chemx/index.db) has been built.
 */
export const isQueryMachineInstalled = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const hasIndexDb = fs.existsSync(path.join(resolvedTarget, '.chemx', 'index.db'));
  if (!hasIndexDb) return false;

  const pkg = readPackageJsonSafely(path.join(resolvedTarget, 'package.json'));
  const scripts = pkg?.scripts || {};
  const hasQueryScript = Boolean(scripts.chemx || scripts.q);
  const hasQueryDependency = isQueryPackageListed(pkg?.dependencies) || isQueryPackageListed(pkg?.devDependencies);
  return hasQueryScript || hasQueryDependency;
};

export const ensurePackageScripts = (targetDir = '.') => {
  const result = addPackageScripts(path.join(path.resolve(targetDir), 'package.json'), () => ({ chemx: 'chemx' }));
  const isAbsent = result.status === 'absent';
  if (isAbsent) return false;
  const isRefused = result.status === 'refused';
  if (isRefused) {
    process.stdout.write(`  \x1b[33m⚠\x1b[0m Could not update package.json scripts: ${result.reason}\n`);
    return false;
  }
  const isWritten = result.status === 'written';
  if (isWritten) process.stdout.write('  \x1b[32m✔\x1b[0m Configured minimal "chemx": "chemx" entry in package.json\n');
  return true;
};

export const installAgentSearchConfig = async (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);

  // 1. Update package.json with minimal single entry
  ensurePackageScripts(resolvedTarget);

  // 2. Prime SQLite query index
  try {
    const { syncSearchIndex } = await import('./search.js');
    const targetSource = fs.existsSync(path.join(resolvedTarget, 'src')) ? 'src' : '.';
    const res = syncSearchIndex(targetSource, resolvedTarget);
    if (res) {
      process.stdout.write(`  \x1b[32m✔\x1b[0m Initialized SQLite query index (.chemx/index.db) across ${res.totalFiles} files\n`);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`[installer] Skipped SQLite indexing: ${error.message}\n`);
  }

  return true;
};

/** Maps a wizard choice to what gets installed. Only option 2 names and writes ~/.gemini. */
export const planWizardTargets = (targetChoice = '1') => {
  const choice = String(targetChoice);
  const isMcpOnly = choice.includes('MCP Server only') || choice === '2';
  const isHookOnly = choice.includes('Hook only') || choice === '5';
  const isCiOnly = choice.includes('CI Workflow only') || choice === '6';
  const isAll = choice.includes('All') || choice === '1';
  return {
    isMcpOnly,
    includeHome: isMcpOnly,
    shouldHook: !isCiOnly,
    shouldWf: !isHookOnly,
    shouldMcp: isAll,
    shouldQuery: isAll
  };
};

export const runInstallWizard = async (targetDir = '.') => {
  const isGit = Boolean(resolveGitHooksDir(targetDir));
  process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255mChemical X: Architecture Guardrail & Query Installer\x1b[0m\n\n');
  const targetChoice = hasGum()
    ? gumChoose([
        '1. Install All Guardrails (Pre-Commit Hook + GitHub CI + project MCP config + Query Index)',
        '2. Model Context Protocol (MCP) Server only (.cursor, .vscode, and Antigravity in ~/.gemini)',
        '3. Architectural Pillars & Agent Steering Wizard (AGENTS.md seed + CLAUDE.md, .cursorrules, llms.txt shims)',
        '4. Query Index only ("chemx" package script for "chemx q" + SQLite index)',
        '5. Git Pre-Commit Hook only (.git/hooks/pre-commit)',
        '6. GitHub Actions CI Workflow only (.github/workflows/chemx-audit.yml)',
        '7. Cancel'
      ])
    : await promptQuestion('Select target: [1] All, [2] MCP, [3] Pillars Wizard, [4] Query Index, [5] Hook, [6] CI, [7] Cancel (default: 1): ');
  const isCancelled = Boolean(targetChoice?.includes('Cancel')) || targetChoice === '7';
  if (isCancelled) return;

  const targets = planWizardTargets(targetChoice);
  if (targets.isMcpOnly) {
    installAllMcpConfigs(targetDir, { silent: false, includeHome: targets.includeHome });
    return;
  }

  const isPillarsOnly = targetChoice.includes('Pillars & Agent Steering') || targetChoice === '3';
  if (isPillarsOnly) {
    await runPillarsWizard(['--write'], targetDir);
    return;
  }

  const isQueryOnly = targetChoice.includes('Query Index only') || targetChoice === '4';
  if (isQueryOnly) {
    process.stdout.write('\n\x1b[1mSetting up the query index for "chemx q"...\x1b[0m\n');
    await installAgentSearchConfig(targetDir);
    process.stdout.write('\n\x1b[1m\x1b[32m✔ Query index ready: agents can run "chemx q".\x1b[0m\n\n');
    return;
  }

  const minGrade = (hasGum() ? gumInput('Minimum required Grade [A+, A, B, C, D] (default: B):', 'B') : await promptQuestion('Minimum required Grade [default: B]: ')) || 'B';
  const minScore = parseInt((hasGum() ? gumInput('Minimum required Score [0-100] (default: 80):', '80') : await promptQuestion('Minimum required Score [default: 80]: ')) || '80', 10);
  const opts = { minGrade: minGrade.trim().toUpperCase(), minScore };

  process.stdout.write('\n\x1b[1mInstalling guardrails...\x1b[0m\n');
  const { shouldHook, shouldWf, shouldMcp, shouldQuery, includeHome } = targets;

  if (shouldHook) {
    if (isGit) installPreCommitHook(targetDir, opts);
    else {
      process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
      ensurePackageScripts(targetDir);
    }
  }
  if (shouldWf) installGitHubWorkflow(targetDir, opts);
  if (shouldMcp) installAllMcpConfigs(targetDir, { silent: false, includeHome });
  if (shouldQuery) await installAgentSearchConfig(targetDir);

  // Line budgets are not written here: they follow the profile via cli/audit/line-budgets.js.
  saveInstallerProjectConfig(targetDir, opts);
  process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X configuration installed successfully!\x1b[0m\n\n');
};
