/**
 * `chemx changelog [--check] [--dry-run] [--json]`
 * Folds the fragments in docs/changelog.d/ into docs/CHANGELOG.md under Unreleased and deletes them;
 * `--check` only validates them (and that they would fold). Reads and writes under the cwd.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CHANGELOG_FILE, FRAGMENT_DIR, readFragments } from './changelog-fragments.js';
import { foldFragments } from './changelog-fold.js';

const USAGE = 'Usage: chemx changelog [--check] [--dry-run] [--json]\n';
const KNOWN_FLAGS = new Set(['--check', '--dry-run', '--json']);

const fragmentPath = (file) => `${FRAGMENT_DIR}/${file}`;

/** Validate every fragment, then try the fold in memory so a missing Unreleased section shows up too. */
const planFold = (cwd) => {
  const fragments = readFragments(cwd);
  const problems = fragments.flatMap((fragment) => fragment.problems.map((reason) => ({ file: fragmentPath(fragment.file), reason })));
  const hasFragments = fragments.length > 0;
  const changelogPath = path.join(cwd, CHANGELOG_FILE);
  const hasChangelog = fs.existsSync(changelogPath);
  const canTryFold = hasFragments && problems.length === 0 && hasChangelog;
  const trial = canTryFold ? foldFragments(fs.readFileSync(changelogPath, 'utf8'), fragments) : null;
  const missing = hasFragments && !hasChangelog ? [{ file: CHANGELOG_FILE, reason: 'not found: nothing to fold into' }] : [];
  const refused = trial?.reason ? [{ file: CHANGELOG_FILE, reason: trial.reason }] : [];
  return { fragments, problems: [...problems, ...missing, ...refused], trial, changelogPath };
};

const summaryOf = (plan, folded) => ({
  fragments: plan.fragments.map((fragment) => ({ file: fragment.file, heading: fragment.heading })),
  problems: plan.problems,
  sections: plan.trial?.sections ?? [],
  folded
});

const fileNames = (plan) => plan.fragments.map((fragment) => fragment.file).join(', ');

const outcomeOf = (plan, { isCheck, isDryRun }) => {
  const hasProblems = plan.problems.length > 0;
  const hasNoFragments = plan.fragments.length === 0;
  const outcomes = [[hasProblems, 'problems'], [isCheck, 'check'], [hasNoFragments, 'empty'], [isDryRun, 'dryRun']];
  return outcomes.find(([applies]) => applies)?.[1] ?? 'folded';
};

const textFor = (plan, mode) => {
  const count = plan.fragments.length;
  const target = `${count} fragment(s) into ${CHANGELOG_FILE} under Unreleased: ${fileNames(plan)}`;
  const rows = plan.problems.map((problem) => `${problem.file}: ${problem.reason}`);
  const messages = {
    problems: [...rows, `changelog: ${plan.problems.length} problem(s), fix them before folding.`].join('\n'),
    check: `changelog: ok. ${count} fragment(s) in ${FRAGMENT_DIR}/, all of them foldable.`,
    empty: `changelog: nothing to fold (no fragments in ${FRAGMENT_DIR}/).`,
    dryRun: `changelog: would fold ${target}. Nothing was written.`,
    folded: `changelog: folded ${target}`
  };
  return messages[outcomeOf(plan, mode)];
};

const applyFold = (cwd, plan) => {
  fs.writeFileSync(plan.changelogPath, plan.trial.text);
  for (const fragment of plan.fragments) fs.unlinkSync(path.join(cwd, FRAGMENT_DIR, fragment.file));
};

export const runChangelogCli = (args, cwd = process.cwd()) => {
  const hasExtraArgs = args.some((arg) => !KNOWN_FLAGS.has(arg));
  if (hasExtraArgs) {
    process.stderr.write(USAGE);
    return { code: 1 };
  }
  const isCheck = args.includes('--check');
  const isDryRun = args.includes('--dry-run');
  const plan = planFold(cwd);
  const isClean = plan.problems.length === 0;
  const isFolding = isClean && !isCheck && !isDryRun && plan.fragments.length > 0;
  if (isFolding) applyFold(cwd, plan);
  const output = args.includes('--json') ? JSON.stringify(summaryOf(plan, isFolding)) : textFor(plan, { isCheck, isDryRun });
  process.stdout.write(`${output}\n`);
  return { code: isClean ? 0 : 1 };
};
