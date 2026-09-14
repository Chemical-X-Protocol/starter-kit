import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';

export { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';

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

export const installAgentSearchConfig = async (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);

  // 1. Update package.json scripts
  const pkgPath = path.join(resolvedTarget, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkg.scripts = pkg.scripts || {};
      pkg.scripts.q = 'chemx search';
      pkg.scripts.search = 'chemx search';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      process.stdout.write('  \x1b[32m✔\x1b[0m Configured "q" and "search" scripts in package.json (run via pnpm q <query>)\n');
    } catch {
      process.stdout.write('  \x1b[33m⚠\x1b[0m Could not update package.json scripts\n');
    }
  }

  // 2. Inject rule into AGENTS.md
  const agentsPath = path.join(resolvedTarget, 'AGENTS.md');
  const searchDirective = `
## Chemical X Codebase Query Machine Protocol
- Search First Rule: AI agents MUST invoke 'pnpm q "<query>"' (or 'npx chemx search "<query>"') before running broad ripgrep, find, or file dumping.
- AST Architecture Intelligence: Always leverage 'pnpm q' to inspect component tiers, exported symbols, props, and hooks with minimal token burn.
- Inspect Mode: Use 'pnpm q "<capsule-name>" --inspect' to examine props and hooks without catting entire source files.
- JSON Mode: Use 'pnpm q "<query>" --json' for zero-overhead, machine-readable agent lookups.
`;

  if (fs.existsSync(agentsPath)) {
    try {
      const content = fs.readFileSync(agentsPath, 'utf-8');
      if (!content.includes('Chemical X Codebase Query Machine Protocol')) {
        fs.appendFileSync(agentsPath, `\n${searchDirective}\n`, 'utf-8');
        process.stdout.write('  \x1b[32m✔\x1b[0m Injected search-first directive into AGENTS.md\n');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      process.stderr.write(`[installer] Skipped AGENTS.md injection: ${error.message}\n`);
    }
  }

  // 3. Prime SQLite query index
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

export const runInstallWizard = async (targetDir = '.') => {
  const isGit = Boolean(resolveGitHooksDir(targetDir));
  process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255mChemical X: Architecture Guardrail & Query Installer\x1b[0m\n\n');
  const targetChoice = hasGum()
    ? gumChoose([
        '1. Install All (Pre-Commit Hook + GitHub CI Workflow + Agent Query Machine)',
        '2. Agent Query Machine only ("pnpm q" script + AGENTS.md rule + SQLite index)',
        '3. Git Pre-Commit Hook only (.git/hooks/pre-commit)',
        '4. GitHub Actions CI Workflow only (.github/workflows/chemx-audit.yml)',
        '5. Cancel'
      ])
    : await promptQuestion('Select target: [1] All, [2] Query Machine, [3] Hook, [4] CI, [5] Cancel (default: 1): ');
  if (targetChoice?.includes('Cancel') || targetChoice === '5') return;

  if (targetChoice?.includes('Query Machine only') || targetChoice === '2') {
    process.stdout.write('\n\x1b[1mInstalling AI Agent Query Machine...\x1b[0m\n');
    await installAgentSearchConfig(targetDir);
    process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X Agent Query Machine installed successfully!\x1b[0m\n\n');
    return;
  }

  const minGrade = (hasGum() ? gumInput('Minimum required Grade [A+, A, B, C, D] (default: B):', 'B') : await promptQuestion('Minimum required Grade [default: B]: ')) || 'B';
  const minScore = parseInt((hasGum() ? gumInput('Minimum required Score [0-100] (default: 80):', '80') : await promptQuestion('Minimum required Score [default: 80]: ')) || '80', 10);
  const opts = { minGrade: minGrade.trim().toUpperCase(), minScore };

  process.stdout.write('\n\x1b[1mInstalling guardrails...\x1b[0m\n');
  const shouldHook = !targetChoice.includes('CI only') && targetChoice !== '4';
  const shouldWf = !targetChoice.includes('Hook only') && targetChoice !== '3';
  const shouldQuery = targetChoice.includes('All') || targetChoice === '1';

  if (shouldHook) {
    if (isGit) installPreCommitHook(targetDir, opts);
    else process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
  }
  if (shouldWf) installGitHubWorkflow(targetDir, opts);
  if (shouldQuery) await installAgentSearchConfig(targetDir);

  saveProjectConfig(targetDir, { minGrade: opts.minGrade, minScore: opts.minScore, maxLineCount: 500, maxMoleculeLineCount: 100 });
  process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X configuration installed successfully!\x1b[0m\n\n');
};
