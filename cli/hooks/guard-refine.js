// Precision for the deny rules (#6756, K11). A deny rule says chemx replaces this tool; a refinement
// checks that chemx replaces THIS argument shape. The rule keeps its deny only when the suggested call
// is a strict superset for the shape. Otherwise the refinement returns:
//   { severity: 'nudge', id, use }   the call runs and the model sees the closest chemx form;
//   { severity: 'allow' }            chemx has nothing for the shape, so no deny and no advice;
//   { severity: 'deny', use }        still denied, with a better hint;
//   null                             the rule is exact as it is.
// Refinements are keyed by rule id (guard-rules*.js); claude-pre-tool.js applies them to the first
// matching rule of each shell segment.

import { gitDirectory, gitSubcommand } from './guard-args.js';
import { locateWord } from './guard-paths.js';
import { inferPathRoot } from '../cli-root.js';
import { gitGrepPattern } from './guard-rules-reads.js';
import { findShape } from './guard-find.js';
import {
  feedsPipe, grepLetters, grepParts, hasCommitLimit, hasUncoveredGrepFlag, isShowCovered, qFlagsFor, revisionRangesIn, shellWords, showShape
} from './guard-shapes.js';

const ALLOW = Object.freeze({ severity: 'allow' });
const nudge = (id, use) => ({ severity: 'nudge', id, use });
const withNote = (id, note) => ({ severity: 'nudge', id, note });
const GIT_TO_CHEMX = { log: 'log', diff: 'd', show: 'show' };
const FOLLOW_FLAGS = new Set(['-f', '-F', '--follow']);

const quoted = (text) => `"${text}"`;
const joined = (words) => words.filter(Boolean).join(' ');

// `git -C <dir> log|diff|show`: chemx reads another repo or worktree with --root, which runs it as if started there.
const rootedGit = (invocation) => {
  const dir = gitDirectory(invocation);
  const isLocal = dir === null;
  if (isLocal) return null;
  const { sub, rest } = gitSubcommand(invocation);
  const isFileAtRevision = sub === 'show' && showShape(rest).operands.some((operand) => operand.includes(':'));
  const call = isFileAtRevision ? 'read' : GIT_TO_CHEMX[sub];
  return nudge('nudge-git-c', `${joined(['chemx', call, '--root', dir, shellWords(rest)])}  (--root runs it as if started in that directory; a bare chemx ${call} would read this project)`);
};

const refineGitLog = (invocation) => {
  const rooted = rootedGit(invocation);
  if (rooted) return rooted;
  const { rest } = gitSubcommand(invocation);
  const hasRange = revisionRangesIn(rest).length > 0;
  if (!hasRange) return null;
  const limit = hasCommitLimit(rest) ? '' : '-n 50';
  return nudge('nudge-git-log-range', `${joined(['chemx log', limit, shellWords(rest)])}  (chemx log shows 10 commits unless -n says more)`);
};

// A diff read by a pipe needs the whole patch: chemx d collapses past 80 lines to --stat without --full.
const refineGitDiff = (invocation, parsed, context) => {
  const rooted = rootedGit(invocation);
  if (rooted) return rooted;
  const { rest } = gitSubcommand(invocation);
  const isPiped = feedsPipe(parsed, context.siblings ?? []);
  const use = `${joined(['chemx d --full', shellWords(rest)])}  (a pipe reads the whole patch; chemx d collapses past 80 lines to --stat without --full)`;
  return isPiped ? { severity: 'deny', use } : null;
};

const refineGitShow = (invocation) => {
  const rooted = rootedGit(invocation);
  if (rooted) return rooted;
  const { rest } = gitSubcommand(invocation);
  if (isShowCovered(rest)) return null;
  const { operands } = showShape(rest);
  const filePath = operands.find((operand) => operand.includes(':'));
  if (filePath) return nudge('nudge-git-show', `chemx read ${filePath}  (add --outline or --symbol=<name>; chemx do "read A" "read B" runs several files)`);
  return nudge('nudge-git-show', `chemx show ${operands[0] ?? 'HEAD'} --patch  (chemx show takes one revision, -p, --stat and --full; this form has more)`);
};

const refineFind = (invocation, parsed, context) => {
  const shape = findShape(invocation, context);
  const byShape = {
    near: withNote('nudge-find', 'chemx f lists files by path text: it cannot limit depth, list directories or combine alternatives'),
    uncovered: ALLOW
  };
  return byShape[shape] ?? null;
};

// tail -f follows a growing file; chemx read cannot.
const refineSourceRead = ({ tool, args }) => (tool === 'tail' && args.some((arg) => FOLLOW_FLAGS.has(arg)) ? ALLOW : null);

// What chemx q -g says about the grep flags: invert/word/quiet have no equivalent, -c and -o have a close one.
const grepFlagRefinement = (letters, { pattern, target }) => {
  if (hasUncoveredGrepFlag(letters)) return ALLOW;
  const search = joined(['chemx q -g', quoted(pattern), target]);
  if (letters.has('c')) return nudge('nudge-grep-count', `${search}  (the header counts the matches; -l lists the files; grep -c counts lines per file)`);
  if (letters.has('o')) return nudge('nudge-grep-only', `${joined([search, '-o --unique', ...qFlagsFor(letters, pattern)])}  (each distinct match once; -n caps the list)`);
  return null;
};

const refineGrepSource = (invocation) => {
  const { pattern, files } = grepParts(invocation);
  return grepFlagRefinement(grepLetters(invocation.args), { pattern, target: files[0] });
};

const refineGitGrep = (invocation) => {
  const git = gitSubcommand(invocation);
  return grepFlagRefinement(grepLetters(git.rest), { pattern: gitGrepPattern(git), target: '' });
};

// A recursive grep only reaches chemx when it looks at the project: free locations are not searched
// by chemx q, and a path outside the project is searched only when a chemx project owns it.
const refineRecursiveGrep = (invocation, parsed, context) => {
  const { pattern, files } = grepParts(invocation);
  const targets = files.length > 0 ? files : ['.'];
  const located = targets.map((word) => locateWord(word, context));
  const looksAtProject = located.some((entry) => entry.kind === 'repo' || entry.kind === 'unknown');
  if (looksAtProject) return grepFlagRefinement(grepLetters(invocation.args), { pattern, target: files[0] });
  const owned = located.find((entry) => entry.kind === 'outside' && inferPathRoot('q', [entry.absolute], context.cwd) !== null);
  if (!owned) return ALLOW;
  const flags = qFlagsFor(grepLetters(invocation.args), pattern);
  return nudge('nudge-grep-outside', `${joined(['chemx q -g', quoted(pattern), owned.absolute, ...flags])}  (chemx q reads a path inside another chemx project; add --regex for a pattern)`);
};

const REFINEMENTS = {
  'raw-git-log': refineGitLog,
  'raw-git-diff': refineGitDiff,
  'raw-git-show': refineGitShow,
  'raw-find': refineFind,
  'raw-source-read': refineSourceRead,
  'raw-grep-source': refineGrepSource,
  'raw-git-grep': refineGitGrep,
  'raw-recursive-grep': refineRecursiveGrep
};

/** The refinement of a deny rule for one segment, or null when the rule is exact as written. */
export const refineRule = (rule, invocation, parsed, context) => {
  const refine = Object.hasOwn(REFINEMENTS, rule.id) ? REFINEMENTS[rule.id] : null;
  return refine ? refine(invocation, parsed, context) : null;
};
