import { handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost } from './tools-team-feed.js';
import { handleChemxTeamTask } from './tools-team-tasks.js';
import { handleChemxTeamLock, handleChemxReportIssue } from './tools-team-locks.js';
import { handleChemxTeamInbox, handleChemxTeamDm } from './tools-team-mailbox.js';

export {
  handleChemxTeamStatus,
  handleChemxTeamFeed,
  handleChemxTeamPost,
  handleChemxTeamTask,
  handleChemxTeamLock,
  handleChemxReportIssue,
  handleChemxTeamInbox,
  handleChemxTeamDm
};

export const handleChemxTeam = async (args = {}, cwd = process.cwd()) => {
  const isTeamAction = args.action === 'team';
  const router = isTeamAction ? (args.subAction || 'status') : (args.subAction || args.action || 'status');
  if (router === 'inbox') return handleChemxTeamInbox(args, cwd);
  if (router === 'dm') return handleChemxTeamDm(args, cwd);
  if (router === 'status') return handleChemxTeamStatus(args, cwd);
  if (router === 'feed') return handleChemxTeamFeed(args, cwd);
  if (router === 'post') return handleChemxTeamPost(args, cwd);
  if (router === 'lock') {
    const isSubAction = Boolean(args.subAction && args.subAction !== 'lock');
    const lockAction = isSubAction ? args.subAction : (args.lockAction || 'status');
    return handleChemxTeamLock({ ...args, action: lockAction }, cwd);
  }
  if (router === 'task') {
    const isSubAction = Boolean(args.subAction && args.subAction !== 'task');
    const taskAction = isSubAction ? args.subAction : (args.taskAction || 'list');
    return handleChemxTeamTask({ ...args, action: taskAction }, cwd);
  }
  const isLockAction = ['acquire', 'release'].includes(router);
  if (isLockAction) {
    return handleChemxTeamLock({ ...args, action: router }, cwd);
  }
  return handleChemxTeamTask({ ...args, action: router }, cwd);
};
