/**
 * Error catcher output policy.
 * A crash report costs tokens and leaves files behind, so the prefilled issue
 * URL and the .chemx/issues report only appear for an interactive human or on
 * explicit opt-in. Posting an issue is never automatic: it needs
 * options.autoPost or CHEMX_AUTO_POST_ISSUES=true, CI or not.
 */
import { isInteractive } from '../terminal.js';

export const resolveCatcherPolicy = (options = {}, env = process.env, interactive = isInteractive()) => {
  const isExplicitSave = options.saveReport === true || options.prepIssue === true || env.CHEMX_SAVE_ISSUES === 'true';
  const isExplicitPrep = options.prepIssue === true || env.CHEMX_PREP_ISSUES === 'true';
  const isAgentEnv = Boolean(env.AGENT || env.ANTIGRAVITY || env.CURSOR || env.NON_INTERACTIVE || env.CLAUDECODE);
  const isHuman = interactive && !isAgentEnv;
  const isExplicitPrompt = Boolean(options.promptIssue || env.CHEMX_PROMPT_ISSUES === 'true');
  return {
    shouldSaveReport: !options.skipFileWrite && (isHuman || isExplicitSave),
    shouldShowIssueUrl: isHuman || isExplicitPrep,
    shouldAutoPost: options.autoPost === true || env.CHEMX_AUTO_POST_ISSUES === 'true',
    canPromptUser: isHuman && isExplicitPrompt,
    useColor: interactive
  };
};
