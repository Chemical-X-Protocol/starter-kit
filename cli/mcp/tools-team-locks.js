import { openIndexDb } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import {
  requestFileLock,
  releaseFileLock,
  getFileLockStatus
} from '../team/team-db.js';
import { handleError } from '../errors/index.js';
import { isPathTraversal } from '../path-scope.js';
import { resolveAgentId } from '../team/agent-identity.js';

export const handleChemxTeamLock = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const action = args.action || 'status';

  if (args.filePath && isPathTraversal(args.filePath, cwd)) {
    return { error: 'path_traversal' };
  }

  // The MCP server outlives a single call, so its pid makes dead-holder cleanup meaningful.
  const agentId = resolveAgentId(args.agentId || args.as);
  if (action === 'acquire') {
    return requestFileLock(db, args.filePath, agentId, {
      purpose: args.purpose,
      ttlMs: args.ttlMs,
      pid: process.pid,
      cwd
    });
  }
  if (action === 'release') {
    return releaseFileLock(db, args.filePath, agentId, { cwd });
  }
  if (action === 'status') {
    const status = getFileLockStatus(db, args.filePath, { cwd });
    if (!status) return null;
    return {
      lease: status.lease,
      expiredLease: status.expiredLease,
      waiters: toColumnar(status.waiters, ['id', 'agent_id', 'priority', 'status', 'requested_at'])
    };
  }
  return { error: `Unknown lock action: ${action}` };
};

export const handleChemxReportIssue = async (args = {}, cwd = process.cwd()) => {
  const errorObj = new Error(args.error || 'Unknown error');
  if (args.stack) errorObj.stack = args.stack;

  const result = await handleError(errorObj, {
    cwd,
    command: args.command,
    repo: args.repo,
    autoPost: Boolean(args.autoPost),
    labels: args.labels,
    silent: true,
    preview: false, // stdio protocol: the agent gets the exact issue in the result instead
    context: args.context,
    skipFileWrite: true
  });

  return {
    success: true,
    issue: {
      title: result.issue.title,
      body: result.issue.body,
      webUrl: result.issue.webUrl,
      targetRepo: result.issue.targetRepo,
      labels: result.issue.labels
    },
    published: result.publishResult.success,
    publishedUrl: result.publishResult.url,
    issueNumber: result.publishResult.issueNumber,
    savedPath: result.savedPath || null
  };
};
