// A `chemx test` run leaves a small record of how it ended under os.tmpdir()/chemx-jobs/<pid>.json
// (CHEMX_JOBS_DIR moves it), so `chemx wait --job=<pid>` can tell the caller of a backgrounded run what
// the verdict was. The job id is the pid of the chemx process: `chemx test ... & chemx wait --job=$!`,
// or the pid in a wait notice or in `chemx test --slots`. Records older than a day are swept when a
// new one is written. Best effort: a run never fails because its record could not be written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAlive } from './slot-files.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const jobsDir = (env = process.env) => env.CHEMX_JOBS_DIR || path.join(os.tmpdir(), 'chemx-jobs');
const recordFile = (dir, pid) => path.join(dir, `${pid}.json`);

// One line saying how a test report ended, plain text.
export const jobSummary = (report) => {
  const counts = `${report.passed ?? 0} passed${report.failed ? `, ${report.failed} failed` : ''}${report.skipped ? `, ${report.skipped} skipped` : ''}`;
  const why = report.executionError || report.detail || report.reason;
  const isPass = report.status === 'pass';
  return isPass ? counts : `${counts}${why ? ` (${String(why).split('\n')[0].slice(0, 160)})` : ''}`;
};

const sweep = (dir, now) => {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const isOld = now - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? now) > DAY_MS;
    if (isOld) fs.rmSync(file, { force: true });
  }
};

// record: { command, status, exitCode, summary }. Returns whether it was written.
export const writeJobRecord = (record, { dir = jobsDir(), pid = process.pid, now = Date.now() } = {}) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    sweep(dir, now);
    fs.writeFileSync(recordFile(dir, pid), JSON.stringify({ pid, endedAt: now, ...record }));
    return true;
  } catch {
    // chemx-allow: best-effort the record is a courtesy to `chemx wait --job` and must never fail the run
    return false;
  }
};

export const readJobRecord = (pid, { dir = jobsDir() } = {}) => {
  try {
    return JSON.parse(fs.readFileSync(recordFile(dir, pid), 'utf8'));
  } catch {
    // chemx-allow: absent-is-normal a job that left no record (still running, swept, or not a chemx test)
    return null;
  }
};

// The state letter of a Linux process (`Z` is a zombie), or null where /proc has no such file.
const procState = (pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
  } catch {
    // chemx-allow: absent-is-normal no /proc here (not Linux) or the process just ended
    return null;
  }
};

// Whether the job's process is still running. A finished child its shell has not collected yet is a
// zombie: it answers a signal 0 but is over, so `chemx test ... & chemx wait --job=$!` must not wait on it.
export const isJobRunning = (pid, { alive = isAlive, state = procState } = {}) => alive(pid) && state(pid) !== 'Z';
