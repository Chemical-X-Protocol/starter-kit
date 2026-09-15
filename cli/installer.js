import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';
import { installAllMcpConfigs } from './mcp/installer.js';

export { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';
export { installAllMcpConfigs } from './mcp/installer.js';

export const resolveGitHooksDir = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const gitPath = path.join(resolvedTarget, '.git');
  if (!fs.existsSync(gitPath)) return null;

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

export const installPreCommitHook = (targetDir = '.', options = {}) => {
  const gitHooksDir = resolveGitHooksDir(targetDir);
  if (!gitHooksDir) {
    process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
    return false;
  }

  if (!fs.existsSync(gitHooksDir)) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
  }

  const hookPath = path.join(gitHooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, buildPreCommitHookScript(options.minGrade, options.minScore), { mode: 0o755 });
  const relativeHook = path.relative(path.resolve(targetDir), hookPath);
  process.stdout.write(`  \x1b[32m✔\x1b[0m Installed git pre-commit hook: ${relativeHook} (chmod +x)\n`);
  return true;
};

export const installGitHubWorkflow = (targetDir = '.', options = {}) => {
  const wfDir = path.resolve(targetDir, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) fs.mkdirSync(wfDir, { recursive: true });
  const wfPath = path.join(wfDir, 'chemx-audit.yml');
  fs.writeFileSync(wfPath, buildGitHubWorkflowScript(options.minGrade, options.minScore), 'utf-8');
  process.stdout.write(`  \x1b[32m✔\x1b[0m Installed GitHub Actions CI workflow: .github/workflows/chemx-audit.yml\n`);
  return true;
};

export const saveProjectConfig = (targetDir = '.', config = {}) => {
  const chemxDir = path.resolve(targetDir, '.chemx');
  if (!fs.existsSync(chemxDir)) fs.mkdirSync(chemxDir, { recursive: true });
  fs.writeFileSync(path.join(chemxDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  process.stdout.write(`  \x1b[32m✔\x1b[0m Saved project settings to: .chemx/config.json\n`);
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
  let hasHook = false;
  if (fs.existsSync(hookPath)) {
    try {
      const hookContent = fs.readFileSync(hookPath, 'utf-8');
      hasHook = hookContent.includes('Chemical X') || hookContent.includes('chemx');
    } catch {
      hasHook = false;
    }
  }

  return hasWf && hasHook;
};

export const runInstallWizard = async (targetDir = '.') => {
  const isGit = Boolean(resolveGitHooksDir(targetDir));
  process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255mChemical X: Architecture Guardrail Installer\x1b[0m\n\n');
  const targetChoice = hasGum()
    ? gumChoose([
        '1. Install All Guardrails (Git Hook + CI Workflow + MCP Server)',
        '2. Model Context Protocol (MCP) Server only (.cursor, .vscode, Antigravity)',
        '3. Git Pre-Commit Hook only (.git/hooks/pre-commit)',
        '4. GitHub Actions CI Workflow only (.github/workflows/chemx-audit.yml)',
        '5. Cancel'
      ])
    : await promptQuestion('Select target: [1] All, [2] MCP, [3] Hook, [4] CI, [5] Cancel (default: 1): ');
  if (targetChoice?.includes('Cancel') || targetChoice === '5') return;

  const isMcpOnly = targetChoice.includes('MCP Server only') || targetChoice === '2';
  if (isMcpOnly) {
    installAllMcpConfigs(targetDir, { silent: false });
    return;
  }

  const minGrade = (hasGum() ? gumInput('Minimum required Grade [A+, A, B, C, D] (default: B):', 'B') : await promptQuestion('Minimum required Grade [default: B]: ')) || 'B';
  const minScore = parseInt((hasGum() ? gumInput('Minimum required Score [0-100] (default: 80):', '80') : await promptQuestion('Minimum required Score [default: 80]: ')) || '80', 10);
  const opts = { minGrade: minGrade.trim().toUpperCase(), minScore };

  process.stdout.write('\n\x1b[1mInstalling guardrails...\x1b[0m\n');
  const shouldHook = !targetChoice.includes('CI Workflow only') && targetChoice !== '4';
  const shouldWf = !targetChoice.includes('Hook only') && targetChoice !== '3';
  const shouldMcp = targetChoice.includes('All Guardrails') || targetChoice === '1';

  if (shouldHook) {
    if (isGit) installPreCommitHook(targetDir, opts);
    else process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
  }
  if (shouldWf) installGitHubWorkflow(targetDir, opts);
  if (shouldMcp) installAllMcpConfigs(targetDir, { silent: false });

  saveProjectConfig(targetDir, { minGrade: opts.minGrade, minScore: opts.minScore, maxLineCount: 500, maxMoleculeLineCount: 100 });
  process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X guardrails installed successfully!\x1b[0m\n\n');
};
