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
  const isInboxRouter = router === 'inbox';
  if (isInboxRouter) return handleChemxTeamInbox(args, cwd);
  const isDmRouter = router === 'dm';
  if (isDmRouter) return handleChemxTeamDm(args, cwd);
  const isStatusRouter = router === 'status';
  if (isStatusRouter) return handleChemxTeamStatus(args, cwd);
  const isFeedRouter = router === 'feed';
  if (isFeedRouter) return handleChemxTeamFeed(args, cwd);
  const isPostRouter = router === 'post';
  if (isPostRouter) return handleChemxTeamPost(args, cwd);
  const isLockRouter = router === 'lock';
  if (isLockRouter) {
    const isSubAction = Boolean(args.subAction && args.subAction !== 'lock');
    const lockAction = isSubAction ? args.subAction : (args.lockAction || 'status');
    return handleChemxTeamLock({ ...args, action: lockAction }, cwd);
  }
  const isTaskRouter = router === 'task';
  if (isTaskRouter) {
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
