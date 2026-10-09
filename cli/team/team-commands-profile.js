/**
 * Chemical X Protocol: `chemx team profile [@handle]` and `chemx team handoff "<summary>" [--task=N]`.
 * Handlers only; runTeamCli (team-commands.js) dispatches to them with its open db.
 */

import { resolveCliAgent } from './team-commands-lock.js';
import { formatProfileBrief, getAgentProfile, recordHandoff } from './team-profile.js';

const writeJson = (isCli, value) => {
  if (isCli) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const handleProfileCommand = (db, nonFlagPositional, flags, isCli) => {
  const named = flags.agent || nonFlagPositional[0];
  const hasNamed = Boolean(named);
  const handle = hasNamed ? named : resolveCliAgent(flags, isCli);
  const profile = getAgentProfile(db, handle, { limit: flags.limit });
  const hasProfile = Boolean(profile);
  if (!hasProfile) return { error: 'profile needs a handle: chemx team profile @handle' };
  if (flags.isJson) {
    writeJson(isCli, profile);
    return profile;
  }
  if (isCli) process.stdout.write(`${formatProfileBrief(profile)}\n`);
  return profile;
};

export const handleHandoffCommand = (db, nonFlagPositional, flags, isCli, titleWords = []) => {
  const summary = [...nonFlagPositional, ...titleWords].join(' ');
  const author = resolveCliAgent(flags, isCli);
  const taskId = flags.task ? Number(flags.task) : null;
  const event = recordHandoff(db, author, summary, { taskId });
  const hasEvent = Boolean(event);
  if (!hasEvent) {
    if (isCli) process.stderr.write('✕ Usage: chemx team handoff "<what is done, what is next>" [--task=N] [--as=@handle]\n');
    return { error: 'handoff summary is required' };
  }
  if (flags.isJson) {
    writeJson(isCli, event);
    return event;
  }
  if (isCli) process.stdout.write(`✔ Recorded handoff #${event.id} from ${event.author_id}\n`);
  return event;
};
