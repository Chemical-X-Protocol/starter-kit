/**
 * Chemical X Protocol: the standup clock (#7671). Pure rules for a task's light; no database, no wiring.
 * 1. An update or done at this standup sends the task back to green.
 * 2. No update moves it up one notch: green to yellow, yellow to red. Red stays red.
 * 3. A red task is discussed; the team sets it to yellow or blocked (setByDiscussion).
 *    A manual yellow or red is a one-standup flag: it resets at the next standup (to green),
 *    and the clock applies as usual from there.
 * 4. blocked holds until someone clears it.
 */
export const LIGHTS = ['green', 'yellow', 'red', 'blocked'];
const DISCUSSION_OUTCOMES = ['yellow', 'blocked'];
const NEXT_NOTCH = { green: 'yellow', yellow: 'red', red: 'red' };

/** The light the clock starts from: a manual flag resets to green first. */
function baseLight(current, isManual) {
  const resetsFlag = isManual && (current === 'yellow' || current === 'red');
  return resetsFlag ? 'green' : current;
}

/** The light for the next standup. */
export function nextLight({ current, hadUpdate, isManual, isBlocked }) {
  const holdsBlocked = isBlocked === true || current === 'blocked';
  if (holdsBlocked) return 'blocked';
  const wasUpdated = hadUpdate === true;
  if (wasUpdated) return 'green';
  const start = baseLight(current, isManual === true);
  return NEXT_NOTCH[start] || 'yellow';
}

/** The outcome of discussing a red task: only yellow or blocked are allowed. */
export function setByDiscussion(light) {
  const allowed = DISCUSSION_OUTCOMES.includes(light);
  if (!allowed) {
    return { ok: false, error: `a red task is set to yellow or blocked, not "${light}"` };
  }
  return { ok: true, light };
}
