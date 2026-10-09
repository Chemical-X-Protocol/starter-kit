/**
 * Chemical X Protocol: the team brief for the SessionStart card.
 * About three lines: my claims, my live locks and unread DMs; files locked by others (top 3); the
 * latest handoff note (mine, else anyone's). Read-only: a brief never creates or migrates a db.
 */

import { closeQuietly, openTeamDbReadOnly } from './team-db-readonly.js';
import { getAgentProfile, latestHandoff, listLiveLocks, toAgentHandle } from './team-profile.js';
import { capLines, handoffLine, listTop } from './team-profile-format.js';

export const TEAM_BRIEF_MAX_CHARS = 380;
const TOP_FILES = 3;

const readBrief = (db, handle, now) => {
  const profile = getAgentProfile(db, handle, { limit: TOP_FILES, now });
  const others = listLiveLocks(db, now).filter((lock) => lock.holder !== handle);
  return {
    agentId: handle,
    claims: profile.claims,
    myLocks: profile.liveLocks,
    unreadDms: profile.unreadDms.count,
    othersLocks: { count: others.length, items: others.slice(0, TOP_FILES) },
    latestHandoff: profile.latestHandoff ?? latestHandoff(db),
  };
};

/** @returns {object | null} null when there is no handle, no sqlite or no .chemx/index.db under root. */
export const collectTeamBrief = ({ root, agentId, now = Date.now() } = {}) => {
  const handle = toAgentHandle(agentId);
  const hasInputs = Boolean(handle) && Boolean(root);
  if (!hasInputs) return null;
  const db = openTeamDbReadOnly(root);
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  try {
    return readBrief(db, handle, now);
  } finally {
    closeQuietly(db);
  }
};

const mineLine = (brief) => {
  const claims = brief.claims.count;
  const hasClaims = claims > 0;
  const claimList = hasClaims ? ` (${listTop(brief.claims, (task) => `#${task.id}`)})` : '';
  const hasUnread = brief.unreadDms > 0;
  const inboxHint = hasUnread ? ': chemx team inbox' : '';
  return `Team ${brief.agentId}: claims ${claims}${claimList} | my locks ${brief.myLocks.count} | unread DMs ${brief.unreadDms}${inboxHint}`;
};

const othersLine = (brief) => {
  const hasOthers = brief.othersLocks.count > 0;
  if (!hasOthers) return null;
  const files = listTop(brief.othersLocks, (lock) => `${lock.file} (${lock.holder})`);
  return `Locked by others ${brief.othersLocks.count}: ${files}. Do not edit those.`;
};

export const formatTeamBrief = (brief, { maxChars = TEAM_BRIEF_MAX_CHARS, now = Date.now() } = {}) => {
  const hasBrief = Boolean(brief?.agentId);
  if (!hasBrief) return '';
  const lines = [mineLine(brief), othersLine(brief), handoffLine(brief.latestHandoff, now)].filter(Boolean);
  return capLines(lines, maxChars);
};
