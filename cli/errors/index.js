import { handleError, resolveTargetIssuesRepo, saveIssueArtifact } from './catcher.js';
import { formatIssueContent, buildIssueTitle, buildIssueBody, buildIssueWebUrl } from './formatter.js';
import { publishIssue, publishIssueViaHttp, publishIssueViaGh } from './publisher.js';
import { sanitizeText, sanitizeStackTrace, maskSensitiveTokens } from './sanitizer.js';

export const withErrorCatcher = async (fn, options = {}) => {
  try {
    return await fn();
  } catch (err) {
    const res = await handleError(err, options);
    const shouldExit = options.exitOnError !== false;
    if (shouldExit) {
      process.exit(options.exitCode ?? 1);
    }
    return res;
  }
};

export const installGlobalErrorCatcher = (options = {}) => {
  const handler = async (err, errorType) => {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    await handleError(errorObj, {
      ...options,
      context: { ...options.context, errorType }
    });
    process.exit(1);
  };

  process.on('uncaughtException', (err) => {
    handler(err, 'uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    handler(reason, 'unhandledRejection');
  });
};

export {
  handleError,
  resolveTargetIssuesRepo,
  saveIssueArtifact,
  formatIssueContent,
  buildIssueTitle,
  buildIssueBody,
  buildIssueWebUrl,
  publishIssue,
  publishIssueViaHttp,
  publishIssueViaGh,
  sanitizeText,
  sanitizeStackTrace,
  maskSensitiveTokens
};
