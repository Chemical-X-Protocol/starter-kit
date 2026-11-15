/**
 * Crew builders for a dispatch run (#7635): with --crew each lane's builder works as an imported crew handle
 * (chemx team crew import) instead of @<run>-<id>, so the work stays on that member's profile. One member per lane:
 * a lane's tasks run one after another, so one handle never builds two tasks at once. A crew task's reviewer and
 * repairer become <crew>-<id>-review / -repair, so run authority (team-dispatcher-authority.js: a role handle
 * starts with the builder's handle) still lets the repair take the task over. The gate keeps @<run>-gate.
 * --assign=@handle gives every task to one handle and needs a single lane.
 */
import { listCrew } from './team-crew.js';

const TIER_RANK = { light: 0, standard: 1, deep: 2 };
const rankOf = (tier) => TIER_RANK[tier] ?? TIER_RANK.standard;

const busyHandles = (db) => new Set(db
  .prepare("SELECT DISTINCT assigned_agent_id AS handle FROM agent_tasks WHERE status = 'in_progress' AND assigned_agent_id IS NOT NULL")
  .all().map((row) => row.handle));

const laneTier = (laneIds, byId) => laneIds
  .map((id) => byId.get(id)?.needs || 'standard')
  .reduce((top, tier) => (rankOf(tier) > rankOf(top) ? tier : top), 'light');

const tierOfCrew = (member) => {
  const match = String(member.capabilities || '').match(/"tier:(light|standard|deep)"/);
  return match ? match[1] : 'standard';
};

/** The free member closest to the tier: an exact match first, then the nearest tier, higher before lower. */
const pickMember = (free, tier) => [...free].sort((a, b) => {
  const distance = (m) => Math.abs(rankOf(tierOfCrew(m)) - rankOf(tier));
  const lower = (m) => (rankOf(tierOfCrew(m)) < rankOf(tier) ? 1 : 0);
  return distance(a) - distance(b) || lower(a) - lower(b) || a.handle.localeCompare(b.handle);
})[0];

const allCrew = (db) => db.prepare('SELECT id AS handle, capabilities FROM agents').all()
  .filter((row) => String(row.capabilities || '').includes('"crew"'));

/**
 * Returns { tasks, crew: [{ lane, handle, tier }], notes: [text] } with each lane's builder handle replaced.
 * options: crew (boolean), assign ('@handle'). Neither set: tasks unchanged.
 */
export const assignCrew = (db, tasks, lanes, { crew = false, assign = '' } = {}) => {
  const hasAssign = Boolean(assign);
  const wantsCrew = Boolean(crew) || hasAssign;
  if (!wantsCrew) return { tasks, crew: [], notes: [] };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const builderOf = new Map();
  const picks = [];
  const notes = [];
  if (hasAssign) {
    const handle = assign.startsWith('@') ? assign : `@${assign}`;
    const isSingleLane = lanes.length <= 1;
    if (!isSingleLane) return { tasks, crew: [], notes: [`--assign=${handle} needs one lane (got ${lanes.length}); add --max-agents=1. Builders kept their run handles.`] };
    for (const id of lanes[0] || []) builderOf.set(id, handle);
    picks.push({ lane: 1, handle, tier: laneTier(lanes[0] || [], byId) });
  } else {
    const busy = busyHandles(db);
    const free = new Set(allCrew(db).filter((member) => !busy.has(member.handle)));
    const hasCrew = listCrew(db).length > 0;
    if (!hasCrew) notes.push('No crew on this board: run chemx team crew import. Builders kept their run handles.');
    lanes.forEach((laneIds, index) => {
      const tier = laneTier(laneIds, byId);
      const member = pickMember(free, tier);
      if (!member) {
        if (hasCrew) notes.push(`lane ${index + 1}: no free crew member; its builder keeps the run handle.`);
        return;
      }
      free.delete(member);
      for (const id of laneIds) builderOf.set(id, member.handle);
      picks.push({ lane: index + 1, handle: member.handle, tier: tierOfCrew(member) });
      const isOffTier = tierOfCrew(member) !== tier;
      if (isOffTier) notes.push(`lane ${index + 1}: ${member.handle} is ${tierOfCrew(member)} crew on ${tier} work (no free ${tier} member).`);
    });
  }
  const withCrew = (task) => {
    const handle = builderOf.get(task.id);
    return { ...task, handle, reviewer: `${handle}-${task.id}-review`, repairer: `${handle}-${task.id}-repair` };
  };
  const mapped = tasks.map((task) => (builderOf.has(task.id) ? withCrew(task) : task));
  return { tasks: mapped, crew: picks, notes };
};
