import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from './installer-templates.js';
import { installAllMcpConfigs } from './mcp/installer.js';
import { runPillarsWizard } from './pillars-wizard.js';

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
  ensurePackageScripts(targetDir);
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

export const ensurePackageScripts = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const pkgPath = path.join(resolvedTarget, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkg.scripts = pkg.scripts || {};
    if (!pkg.scripts.chemx) {
      pkg.scripts.chemx = 'chemx';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      process.stdout.write('  \x1b[32m✔\x1b[0m Configured minimal "chemx": "chemx" entry in package.json\n');
    }
    return true;
  } catch {
    process.stdout.write('  \x1b[33m⚠\x1b[0m Could not update package.json scripts\n');
    return false;
  }
};

export const installAgentSearchConfig = async (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);

  // 1. Update package.json with minimal single entry
  ensurePackageScripts(resolvedTarget);

  // 2. Inject rule into AGENTS.md
  const agentsPath = path.join(resolvedTarget, 'AGENTS.md');
  const agentDirectives = `
## Chemical X Database-First Navigation & Targeted Symbol Extraction Protocol
- Database Master Index First: Before inspecting or modifying files, AI agents MUST query the SQLite database ('.chemx/index.db') or the AST Query Machine ('chemx({ action: "team", params: { action: "list" } })', 'chemx({ action: "q", params: { query } })') before broad ripgrep or file scans.
- Targeted Symbol Reading Only: AI agents MUST NEVER dump entire source files into context. Extract only specific symbols: 'chemx({ action: "read", params: { path, symbol: "<name>" } })'.
- Symbol Connections: Inspect callers and dependencies via 'connections: true' ('chemx({ action: "read", params: { path, symbol: "<name>", connections: true } })') to understand integration without loading multiple files.
- Prohibition on Native File Analyzers: NEVER invoke native IDE file-viewing tools ('view_file', 'read_file', 'cat', 'head') or full-file context dumps on Chemical X projects. All inspection must flow through Chemical X AST readers.

## Chemical X Master MCP Gateway & Verification-First Protocol
- Master MCP Gateway Rule: In AI IDE environments (Antigravity, Cursor, Claude Desktop), invoke the unified master "chemx" MCP tool (e.g. chemx({ action: 'verify' })) to avoid per-tool permission prompts and eliminate bash subshell overhead.
- Verification First Rule: AI agents MUST NEVER run raw, unthrottled "npm test", "pnpm test", "vitest", "tsc --noEmit", or "npm run build" directly in a bash subshell.
- MCP Verification Tools First: AI agents MUST invoke dedicated Chemical X MCP tools or CLI wrappers ('chemx verify', 'npx chemx verify', 'pnpm chemx build', 'npx chemx build') before running terminal commands.
`;

  if (fs.existsSync(agentsPath)) {
    try {
      const content = fs.readFileSync(agentsPath, 'utf-8');
      const hasQueryProtocol = content.includes('Chemical X Codebase Query Machine Protocol');
      const hasVerifyProtocol = content.includes('Chemical X Verification-First Protocol');

      const isMissingBoth = !hasQueryProtocol && !hasVerifyProtocol;
      if (isMissingBoth) {
        fs.appendFileSync(agentsPath, `\n${agentDirectives}\n`, 'utf-8');
        process.stdout.write('  \x1b[32m✔\x1b[0m Injected query and verification directives into AGENTS.md\n');
      } else if (!hasVerifyProtocol) {
        const verifyOnly = `
## Chemical X Verification-First Protocol & Zero-Token-Burn Pipeline
- Verification First Rule: AI agents MUST NEVER run raw, unthrottled "npm test", "pnpm test", "vitest", "tsc --noEmit", or "npm run build" directly in a bash subshell.
- MCP Verification Tools First: AI agents MUST invoke dedicated Chemical X MCP tools or CLI wrappers ('pnpm chemx verify', 'npx chemx verify', 'pnpm chemx build', 'npx chemx build') before running terminal commands.
`;
        fs.appendFileSync(agentsPath, `\n${verifyOnly}\n`, 'utf-8');
        process.stdout.write('  \x1b[32m✔\x1b[0m Injected verification-first directive into AGENTS.md\n');
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
        '1. Install All Guardrails (Pre-Commit Hook + GitHub CI + MCP Server + Query Machine)',
        '2. Model Context Protocol (MCP) Server only (.cursor, .vscode, Antigravity)',
        '3. Architectural Pillars & Agent Steering Wizard (AGENTS.md, .cursorrules)',
        '4. Agent Query Machine only ("pnpm q" script + AGENTS.md rule + SQLite index)',
        '5. Git Pre-Commit Hook only (.git/hooks/pre-commit)',
        '6. GitHub Actions CI Workflow only (.github/workflows/chemx-audit.yml)',
        '7. Cancel'
      ])
    : await promptQuestion('Select target: [1] All, [2] MCP, [3] Pillars Wizard, [4] Query Machine, [5] Hook, [6] CI, [7] Cancel (default: 1): ');
  if (targetChoice?.includes('Cancel') || targetChoice === '7') return;

  const isMcpOnly = targetChoice.includes('MCP Server only') || targetChoice === '2';
  if (isMcpOnly) {
    installAllMcpConfigs(targetDir, { silent: false });
    return;
  }

  const isPillarsOnly = targetChoice.includes('Pillars & Agent Steering') || targetChoice === '3';
  if (isPillarsOnly) {
    await runPillarsWizard([], targetDir);
    return;
  }

  const isQueryOnly = targetChoice.includes('Query Machine only') || targetChoice === '4';
  if (isQueryOnly) {
    process.stdout.write('\n\x1b[1mInstalling AI Agent Query Machine...\x1b[0m\n');
    await installAgentSearchConfig(targetDir);
    process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X Agent Query Machine installed successfully!\x1b[0m\n\n');
    return;
  }

  const minGrade = (hasGum() ? gumInput('Minimum required Grade [A+, A, B, C, D] (default: B):', 'B') : await promptQuestion('Minimum required Grade [default: B]: ')) || 'B';
  const minScore = parseInt((hasGum() ? gumInput('Minimum required Score [0-100] (default: 80):', '80') : await promptQuestion('Minimum required Score [default: 80]: ')) || '80', 10);
  const opts = { minGrade: minGrade.trim().toUpperCase(), minScore };

  process.stdout.write('\n\x1b[1mInstalling guardrails...\x1b[0m\n');
  const shouldHook = !targetChoice.includes('CI Workflow only') && targetChoice !== '6';
  const shouldWf = !targetChoice.includes('Hook only') && targetChoice !== '5';
  const isAll = targetChoice.includes('All') || targetChoice === '1';
  const shouldMcp = isAll;
  const shouldQuery = isAll;

  if (shouldHook) {
    if (isGit) installPreCommitHook(targetDir, opts);
    else {
      process.stdout.write('  \x1b[33m⚠\x1b[0m Skipped .git/hooks (current directory is not a git repository root or submodule).\n');
      ensurePackageScripts(targetDir);
    }
  }
  if (shouldWf) installGitHubWorkflow(targetDir, opts);
  if (shouldMcp) installAllMcpConfigs(targetDir, { silent: false });
  if (shouldQuery) await installAgentSearchConfig(targetDir);

  saveProjectConfig(targetDir, { minGrade: opts.minGrade, minScore: opts.minScore, maxLineCount: 500, maxMoleculeLineCount: 100 });
  process.stdout.write('\n\x1b[1m\x1b[32m✔ Chemical X configuration installed successfully!\x1b[0m\n\n');
};
