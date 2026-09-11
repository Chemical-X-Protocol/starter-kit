import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';

export { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';

export const installPreCommitHook = (targetDir = '.', options = {}) => {
  const gitHooksDir = path.resolve(targetDir, '.git', 'hooks');
  if (!fs.existsSync(gitHooksDir)) fs.mkdirSync(gitHooksDir, { recursive: true });
  const hookPath = path.join(gitHooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, buildPreCommitHookScript(options.minGrade, options.minScore), { mode: 0o755 });
  process.stdout.write(`  \x1b[32m✔\x1b[0m Installed git pre-commit hook: .git/hooks/pre-commit (chmod +x)\n`);
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

  const gitPath = path.join(resolvedTarget, '.git');
  let hasGit = false;
  let hooksDir = null;

  if (fs.existsSync(gitPath)) {
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        hasGit = true;
        hooksDir = path.join(gitPath, 'hooks');
      } else if (stat.isFile()) {
        hasGit = true;
        const gitContent = fs.readFileSync(gitPath, 'utf-8');
        const match = gitContent.match(/gitdir:\s*(.+)/);
        if (match) {
          hooksDir = path.resolve(resolvedTarget, match[1].trim(), 'hooks');
        }
      }
    } catch {
      hasGit = false;
    }
  }

  if (!hasGit) {
    return hasWf;
  }

  let hasHook = false;
  if (hooksDir) {
    const hookPath = path.join(hooksDir, 'pre-commit');
    if (fs.existsSync(hookPath)) {
      try {
        const hookContent = fs.readFileSync(hookPath, 'utf-8');
        hasHook = hookContent.includes('Chemical X') || hookContent.includes('chemx');
      } catch {
        hasHook = false;
      }
    }
  }

  return hasWf && hasHook;
};

export const runInstallWizard = async (targetDir = '.') => {
  const isGit = fs.existsSync(path.resolve(targetDir, '.git'));
  process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255mChemical X: Architecture Guardrail Installer\x1b[0m\n\n');
  const targetChoice = hasGum()
    ? gumChoose(['1. Install All Guardrails (Git Pre-Commit Hook + GitHub CI Workflow)', '2. Git Pre-Commit Hook only (.git/hooks/pre-commit)', '3. GitHub Actions CI Workflow only (.github/workflows/chemx-audit.yml)', '4. Cancel'])
    : await promptQuestion('Select target: [1] All, [2] Hook, [3] CI, [4] Cancel (default: 1): ');
  if (targetChoice?.includes('Cancel') || targetChoice === '4') return;

  const minGrade = (hasGum() ? gumInput('Minimum required Grade [A+, A, B, C, D] (default: B):', 'B') : await promptQuestion('Minimum required Grade [default: B]: ')) || 'B';
  const minScore = parseInt((hasGum() ? gumInput('Minimum required Score [0-100] (default: 80):', '80') : await promptQuestion('Minimum required Score [default: 80]: ')) || '80', 10);
  const opts = { minGrade: minGrade.trim().toUpperCase(), minScore };

  process.stdout.write('\n\x1b[1mInstalling guardrails...\x1b[0m\n');
  const shouldHook = !targetChoice.includes('CI only') && targetChoice !== '3';
  const shouldWf = !targetChoice.includes('Hook only') && targetChoice !== '2';

  if (shouldHook) {
    if (isGit) installPreCommitHook(targetDir, opts);
    else process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root).\n');
  }
  if (shouldWf) installGitHubWorkflow(targetDir, opts);
  saveProjectConfig(targetDir, { minGrade: opts.minGrade, minScore: opts.minScore, maxLineCount: 500, maxMoleculeLineCount: 100 });
  process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X guardrails installed successfully!\x1b[0m\n\n');
};
