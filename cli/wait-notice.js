// The waiting notice of a run in a queue (the light slots of test-slots.js, the heavy line of
// job-line.js): said once, with the job's id and how to wait for it, then again only when the
// situation changed (a new position, a different holder), and never more often than every
// `statusMs`. Time passing is not a change: a holder's age, or the seconds waited, do not count.

// `[job 4242: chemx wait --job=4242]`: the pid names the job for `chemx wait --job=<pid>`.
export const jobHint = (pid = process.pid) => `[job ${pid}: chemx wait --job=${pid}]`;

const withJobHint = (line) => line.replace(/\n?$/, ` ${jobHint()}\n`);

// `say` receives the line (the first one carries the job hint). The returned function takes the
// situation as a string and a thunk for the line, and returns whether it spoke.
export const makeNotice = (statusMs, say) => {
  let lastSituation = null;
  let lastAt = 0;
  return (situation, makeLine, now = Date.now()) => {
    const isFirst = lastSituation === null;
    const hasChanged = situation !== lastSituation && now - lastAt >= statusMs;
    const isDue = isFirst || hasChanged;
    if (!isDue) return false;
    const line = makeLine();
    say(isFirst ? withJobHint(line) : line);
    lastSituation = situation;
    lastAt = now;
    return true;
  };
};
