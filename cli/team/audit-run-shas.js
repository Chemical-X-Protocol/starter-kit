/**
 * Chemical X Protocol: cross-check the commit shas a run reported against git and the handle (#4462).
 * Collects shas from the run window in the coordination feed: `commit` events (recordCommit) and the text of
 * any feed row a run handle authored that names a sha after the word commit, committed or sha. Each is checked with
 * `git cat-file -e` and `git show`. Statuses: ok, missing (git does not have it), rewritten (missing, but a commit
 * with the same subject exists in the window: amend or squash), other-handle (attributed to another handle).
 *
 * Attribution is INFERRED, never proof: the Chemx-Agent trailer when the commit has one, else the claimant of
 * the task id in the subject (#NNNN). All agents commit as one git user, so the author is not used. Not done:
 * attribution from the lease holder of the touched files, shas written without the word commit/sha before them,
 * and shas in transcripts that never reached the feed. Pure read; no network.
 */
import { spawnSync } from 'node:child_process';
import { safeAll } from './team-db-readonly.js';

const SLACK_MS = 15 * 60 * 1000;
const SEP = '\u001f';
const END = '\u001e';
const SHA_AFTER_WORD = /\b(?:commits?|committed|sha)\b[:=\s`'"(]*([0-9a-f]{7,40})\b/gi;
const TRAILER = /^Chemx-Agent:\s*(\S+)/im;
const TASK_MARK = /#(\d+)/g;

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

/** Shas named after commit/committed/sha in a text. */
export const shasIn = (text) => [...String(text ?? '').matchAll(SHA_AFTER_WORD)].map((m) => m[1].toLowerCase());

/** { sha, subject, trailer, files } for a commit, or null when git does not have it (or root is not a repo). */
export const inspectSha = (root, sha) => {
  const exists = git(root, ['cat-file', '-e', `${sha}^{commit}`]);
  const isAbsent = exists.status !== 0;
  if (isAbsent) return null;
  const shown = git(root, ['show', '--name-only', `--format=%H${SEP}%s${SEP}%B${END}`, sha]);
  const isUnreadable = shown.status !== 0;
  if (isUnreadable) return null;
  const [head, tail = ''] = shown.stdout.split(END);
  const [full, subject, body = ''] = head.split(SEP);
  return { sha: full.trim(), subject, trailer: body.match(TRAILER)?.[1] ?? null, files: tail.split('\n').map((f) => f.trim()).filter(Boolean) };
};

const windowCommits = (root, win) => {
  const after = Math.floor(win.from / 1000);
  const before = Math.ceil((win.to + SLACK_MS) / 1000);
  const out = git(root, ['log', `--after=${after}`, `--before=${before}`, `--format=%H${SEP}%s`]);
  const isFailed = out.status !== 0;
  if (isFailed) return [];
  return out.stdout.split('\n').filter(Boolean).map((l) => {
    const [sha, subject] = l.split(SEP);
    return { sha, subject };
  });
};

const taskIdOf = (subject) => {
  const ids = [...String(subject ?? '').matchAll(TASK_MARK)].map((m) => Number(m[1]));
  return ids.length ? ids[ids.length - 1] : null;
};

const metaOf = (row) => {
  try {
    return JSON.parse(row.metadata || '{}');
  } catch {
    return {};
  }
};

const claimantOf = (db, taskId) => {
  const hasTask = taskId !== null;
  if (!hasTask) return null;
  const [row] = safeAll(db, 'SELECT assigned_agent_id FROM agent_tasks WHERE id = ?', [taskId]);
  return row?.assigned_agent_id || null;
};

const windowOf = (agents) => {
  const starts = agents.map((a) => a.startedAt).filter(Number.isFinite);
  const ends = agents.map((a) => a.endedAt).filter(Number.isFinite);
  return starts.length && ends.length ? { from: Math.min(...starts), to: Math.max(...ends) } : null;
};

/** Reports in the window: [{ sha, reporter, source }], one per reporter and sha. */
const reportsOf = (db, agents, win) => {
  const handles = new Set(agents.map((a) => a.handle));
  const rows = safeAll(db, 'SELECT * FROM agent_feed WHERE timestamp >= ? AND timestamp <= ? ORDER BY id', [win.from, win.to + SLACK_MS]).filter((r) => handles.has(r.author_id));
  const seen = new Set();
  const reports = [];
  for (const r of rows) {
    const meta = metaOf(r);
    const isCommitEvent = r.event_type === 'commit' && typeof meta.sha === 'string';
    const found = isCommitEvent ? [String(meta.sha).toLowerCase()] : shasIn(r.message);
    for (const sha of found) {
      const key = `${r.author_id}\u0000${sha}`;
      const isRepeat = seen.has(key);
      if (isRepeat) continue;
      seen.add(key);
      reports.push({ sha, reporter: r.author_id, source: isCommitEvent ? 'commit event' : 'feed text', subject: isCommitEvent ? meta.subject ?? null : null });
    }
  }
  return reports;
};

const verdict = (db, report, commit, inWindow) => {
  const isAbsent = !commit;
  if (isAbsent) {
    const same = report.subject && inWindow.find((c) => c.subject === report.subject);
    return same ? { status: 'rewritten', note: `sha not in git; commit ${same.sha.slice(0, 7)} has the same subject (amend or squash)` } : { status: 'missing', note: 'unknown sha: git does not have this commit' };
  }
  const taskId = taskIdOf(commit.subject);
  const claimant = commit.trailer ?? claimantOf(db, taskId);
  const taskBasis = taskId === null ? 'none' : `claimant of #${taskId} (inferred from task id)`;
  const basis = commit.trailer ? 'Chemx-Agent trailer' : taskBasis;
  const isOther = Boolean(claimant) && claimant !== report.reporter;
  return { status: isOther ? 'other-handle' : 'ok', attributedTo: claimant, basis, subject: commit.subject, note: isOther ? `inferred as ${claimant}'s, reported by ${report.reporter}` : '' };
};

/**
 * Cross-check reported shas. agents: priced rows ({ handle, startedAt, endedAt }). gitRoot: the repo to ask.
 * @returns {{ available: boolean, note: string, items: object[], missing: object[], otherHandle: object[], rewritten: object[], unreported: object[] }}
 */
export const crossCheckShas = (db, agents, gitRoot) => {
  const empty = { items: [], missing: [], otherHandle: [], rewritten: [], unreported: [] };
  const win = db && gitRoot ? windowOf(agents) : null;
  const isUnavailable = !win;
  if (isUnavailable) return { available: false, note: 'no coordination db, git root or run window, so reported shas were not checked', ...empty };
  const inWindow = windowCommits(gitRoot, win);
  const items = reportsOf(db, agents, win).map((report) => {
    const commit = inspectSha(gitRoot, report.sha);
    return { ...report, ...verdict(db, report, commit, inWindow) };
  });
  const handles = new Set(agents.map((a) => a.handle));
  const unreported = inWindow.filter((c) => !items.some((i) => c.sha.startsWith(i.sha) || i.sha.startsWith(c.sha))).map((c) => ({ sha: c.sha, subject: c.subject, taskId: taskIdOf(c.subject), claimant: claimantOf(db, taskIdOf(c.subject)) })).filter((c) => handles.has(c.claimant));
  return {
    available: true,
    note: 'attribution is inferred from the Chemx-Agent trailer or the task id in the subject, not proof; shas are found only after the word commit, committed or sha in feed rows',
    items, missing: items.filter((i) => i.status === 'missing'), otherHandle: items.filter((i) => i.status === 'other-handle'), rewritten: items.filter((i) => i.status === 'rewritten'), unreported
  };
};

/** Report lines for the audit-run text output and the receipt (#4454). */
export const shaLines = (s) => {
  const head = '7. Commit cross-check';
  const isUnavailable = !s.available;
  if (isUnavailable) return [head, `  not checked: ${s.note}`];
  const row = (i) => `    ${i.sha.slice(0, 7)} reported by ${i.reporter} (${i.source}): ${i.note}`;
  return [
    head,
    `  ${s.items.length} reported sha(s): ${s.missing.length} missing, ${s.otherHandle.length} attributed to another handle, ${s.rewritten.length} rewritten (not counted)`,
    ...s.missing.map(row), ...s.otherHandle.map(row), ...s.rewritten.map(row),
    ...s.unreported.map((u) => `    ${u.sha.slice(0, 7)} ${u.subject}: claimed by ${u.claimant}, no report (info)`),
    `  (${s.note})`
  ];
};
