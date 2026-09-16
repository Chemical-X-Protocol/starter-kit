import { hasGum, gumChoose, promptQuestion } from './terminal.js';
import { promptAuditScope } from './audit-preflight-scope.js';
import { isNonInteractiveSession } from './audit/rules-predicates.js';
import { resolveGitAuditScope } from './audit-preflight-git.js';

export { detectCandidateDirectories } from './audit-preflight-scope.js';
export { resolveGitAuditScope, getGitChangedFiles } from './audit-preflight-git.js';

const DEPTH_OPTIONS = [
  '🔬 Full AST Audit (Deep molecular analysis, AST visitors, slop, patterns)',
  '⚡ Fast Scan (Instant line-budget, token burn, and file metrics)'
];

const promptAuditDepth = async (rawArgs) => {
  const hasFastFlag = rawArgs.includes('--fast') || rawArgs.includes('--quick');
  const hasFullFlag = rawArgs.includes('--full') || rawArgs.includes('--deep');

  if (hasFastFlag) return true;
  if (hasFullFlag) return false;

  let depthChoice = '';
  if (hasGum()) {
    depthChoice = gumChoose(DEPTH_OPTIONS, 'Select Audit Depth:');
  } else {
    process.stdout.write('\n' + DEPTH_OPTIONS.map((opt, i) => ` ${i + 1}. ${opt}`).join('\n') + '\n\n');
    const ans = await promptQuestion(`Select audit depth [1-${DEPTH_OPTIONS.length}]: `);
    const index = parseInt(ans, 10) - 1;
    depthChoice = DEPTH_OPTIONS[index] || '';
  }

  const isCancelled = !depthChoice;
  if (isCancelled) return null;

  return depthChoice.includes('Fast');
};

export const runAuditPreflight = async (rawArgs, options = {}) => {
  const { customDir = null, defaultDir = 'src', cwd = process.cwd() } = options;

  const isNonInteractive = isNonInteractiveSession(rawArgs);
  const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const hasYesFlag = rawArgs.includes('-y') || rawArgs.includes('--yes');
  const isInteractive = !isNonInteractive && hasTty && !hasYesFlag;

  const hasExplicitDir = Boolean(customDir) || rawArgs.some((arg) => arg.startsWith('--dir='));
  const hasExplicitGit = rawArgs.includes('--git') || rawArgs.includes('--changed');
  const hasExplicitFast = rawArgs.includes('--fast') || rawArgs.includes('--quick');
  const hasExplicitFull = rawArgs.includes('--full') || rawArgs.includes('--deep');
  const isFullySpecified = (hasExplicitDir || hasExplicitGit) && (hasExplicitFast || hasExplicitFull);

  if (!isInteractive || isFullySpecified) {
    const fast = hasExplicitFast;
    const fileList = hasExplicitGit ? resolveGitAuditScope(cwd).files : null;
    return { targetDir: customDir || defaultDir, fast, fileList };
  }

  process.stdout.write('\n\x1b[1m\x1b[38;5;45m⚡ Chemical X Protocol\x1b[0m \x1b[38;5;220mInteractive Pre-Flight\x1b[0m\n\n');

  let targetDir = customDir || defaultDir;
  let fileList = null;

  const needsScopePrompt = !hasExplicitDir && !hasExplicitGit;
  if (needsScopePrompt) {
    const scopeResult = await promptAuditScope(defaultDir, rawArgs, cwd);
    if (!scopeResult) {
      process.exit(0);
    }
    targetDir = scopeResult.targetDir;
    fileList = scopeResult.fileList;
  } else if (hasExplicitGit) {
    fileList = resolveGitAuditScope(cwd).files;
  }

  const depthResult = await promptAuditDepth(rawArgs);
  if (depthResult === null) {
    process.exit(0);
  }
  const fast = depthResult;

  const modeLabel = fast ? 'Fast line-budget scan' : 'Full molecular AST audit';
  const targetLabel = fileList ? `${fileList.length} git modified file(s)` : targetDir;
  process.stdout.write(`\n\x1b[36m⚡ Starting ${modeLabel} for ${targetLabel}...\x1b[0m\n\n`);

  return { targetDir, fast, fileList };
};
