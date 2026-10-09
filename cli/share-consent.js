// Share consent: show exactly what will be posted and where, then require an explicit yes.
import { confirmAction } from './terminal.js';
import { STATUS, toExitCode } from './result-status.js';

const YES_FLAGS = new Set(['--yes', '-y']);

export const hasYesFlag = (args = []) => args.some((arg) => YES_FLAGS.has(arg));

export const renderSharePreview = ({ repo, category, title, body, existingNumber = null }) => {
  const rule = '-'.repeat(60);
  const hasExisting = Boolean(existingNumber);
  const updateNote = hasExisting
    ? `Action:   update discussion #${existingNumber} (its previous body is archived as a comment)`
    : 'Action:   create a new discussion, or update the one already posted for this project';
  return [
    '',
    'The following will be posted publicly to GitHub Discussions:',
    `Repo:     https://github.com/${repo}`,
    `Category: ${category}`,
    updateNote,
    rule,
    `Title: ${title}`,
    rule,
    body,
    rule,
    ''
  ].join('\n');
};

// Non-interactive sessions refuse unless --yes was given; interactive sessions default to no.
export const confirmShare = async ({ repo, isYes = false, canPrompt = false, confirm = confirmAction }) => {
  if (isYes) return { confirmed: true, declined: false, reason: null };
  if (!canPrompt) {
    const reason = 'Share refused: this session is not interactive, so nothing can be confirmed. Run it in a terminal to preview and confirm, or add --yes to post without a prompt. Nothing was posted.';
    return { confirmed: false, declined: false, reason };
  }
  const isConfirmed = await confirm(`Post this to github.com/${repo} Discussions?`, 'Post', 'Cancel', false);
  if (isConfirmed) return { confirmed: true, declined: false, reason: null };
  return { confirmed: false, declined: true, reason: 'Share cancelled. Nothing was posted.' };
};

export const shareResult = (status, posted, reason, extra = {}) => ({ status, posted, reason, ...extra });

// A user who declines at the prompt chose not to post; that is not an error exit.
export const shareExitCode = (result) => {
  const isUserDecline = Boolean(result && result.declined);
  if (isUserDecline) return 0;
  return toExitCode(result ? result.status : STATUS.FAIL);
};
