// Share outcome: report a publish result, or hand the content to the browser when publishing failed.
import { hasGum, gumChoose, promptQuestion, openBrowser } from './terminal.js';
import {
  copyToClipboard,
  ORG_DISCUSSIONS_URL,
  DEFAULT_DISCUSSION_REPO,
  DISCUSSION_CATEGORY_SLUG
} from './audit.js';
import { STATUS } from './result-status.js';
import { shareResult } from './share-consent.js';

const reportPublished = (pubResult) => {
  const isUpdated = Boolean(pubResult.updated);
  if (isUpdated) {
    process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully updated discussion topic #${pubResult.discussionNumber}!\x1b[0m\n`);
    process.stdout.write('  \x1b[33mPrevious audit checkpoint was archived as a comment in the thread.\x1b[0m\n');
    process.stdout.write(`Discussion URL: \x1b[36m${pubResult.url}\x1b[0m\n\n`);
    return;
  }
  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully published discussion topic!\x1b[0m\nDiscussion URL: \x1b[36m${pubResult.url}\x1b[0m\n\n`);
};

const buildFallbackUrl = (pubResult, title, categorySlug) => {
  const targetSlug = categorySlug || DISCUSSION_CATEGORY_SLUG || 'npx-chemx-audit';
  const hasDiscussionNumber = Boolean(pubResult.discussionNumber);
  if (hasDiscussionNumber) return `https://github.com/${DEFAULT_DISCUSSION_REPO}/discussions/${pubResult.discussionNumber}`;
  return `${ORG_DISCUSSIONS_URL}/new?category=${encodeURIComponent(targetSlug)}&title=${encodeURIComponent(title)}`;
};

export const reportShareOutcome = async ({ pubResult, title, body, categorySlug, canPrompt }) => {
  const isPublished = Boolean(pubResult.success && pubResult.url);
  let result;
  if (isPublished) {
    reportPublished(pubResult);
    if (canPrompt) openBrowser(pubResult.url);
    result = shareResult(STATUS.PASS, true, null, { url: pubResult.url });
  } else {
    const fallbackUrl = buildFallbackUrl(pubResult, title, categorySlug);
    const reason = `Publish failed${pubResult.error ? `: ${pubResult.error}` : ''}. Post it manually at ${fallbackUrl}`;
    if (canPrompt) {
      copyToClipboard(body);
      process.stdout.write('\n\x1b[32m✔ Formatted audit report copied to your system clipboard!\x1b[0m\n');
      process.stdout.write(`Opening GitHub Discussions in default browser:\n  \x1b[36m${fallbackUrl}\x1b[0m\n\n`);
      openBrowser(fallbackUrl);
    } else {
      process.stderr.write(`${reason}\n`);
    }
    result = shareResult(STATUS.FAIL, false, reason, { url: fallbackUrl });
  }
  if (!canPrompt) return result;
  if (hasGum()) {
    gumChoose(['<-- Back to Audit Dashboard']);
  } else {
    await promptQuestion('Press Enter to return to menu...');
  }
  return result;
};
