/**
 * #6760 (K15): `chemx ci --protection` reads whether the default branch requires status checks, and
 * warns when it does not, because `gh pr merge --auto` then merges at once (kit PR #12). gh is stubbed;
 * the replies are copied from the real kit repo (branch not protected, no rulesets).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCi } from './ci-command.js';

const ok = (value) => ({ ok: true, code: 0, stdout: JSON.stringify(value), stderr: '', missing: false });
const refused = (stderr, stdout = '', code = 1) => ({ ok: false, code, stdout, stderr, missing: false });
const NOT_PROTECTED = refused('gh: Branch not protected (HTTP 404)', '{"message":"Branch not protected","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"404"}');
const REPO = ok({ nameWithOwner: 'o/r', defaultBranchRef: { name: 'main' } });

// gh answers by endpoint; every call is recorded.
const makeGh = ({ repo = REPO, protection = NOT_PROTECTED, rules = ok([]) }) => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const isRepo = args[0] === 'repo';
    const isRules = args[1]?.includes('/rules/branches/');
    return (isRepo && repo) || (isRules && rules) || protection;
  };
  return { gh, calls };
};

const run = async (args, replies) => {
  const { gh, calls } = makeGh(replies);
  const out = [];
  const result = await runCi(args, { gh, write: (text) => out.push(text) });
  return { result, calls, text: out.join('') };
};

test('an unprotected default branch: exit 1, checks none, and the warning about gh pr merge --auto', async () => {
  const { result, calls, text } = await run(['--protection', '--repo', 'o/r'], {});
  assert.equal(result.code, 1);
  assert.match(text, /^o\/r main$/m);
  assert.match(text, /^required status checks: none/m);
  assert.match(text, /^WARNING: gh pr merge --auto merges at once/m);
  assert.deepEqual(calls[0].slice(0, 3), ['repo', 'view', 'o/r']);
  assert.ok(calls.some((c) => c[0] === 'api' && c[1] === 'repos/o/r/branches/main/protection'));
});

test('required status checks are listed, with the up-to-date rule, and there is no warning: exit 0', async () => {
  const body = { required_status_checks: { strict: true, contexts: ['Audit'], checks: [{ context: 'Audit', app_id: 1 }, { context: 'Smoke', app_id: 1 }] }, required_pull_request_reviews: { required_approving_review_count: 1 } };
  const { result, text } = await run(['--protection'], { protection: ok(body) });
  assert.equal(result.code, 0);
  assert.match(text, /^required status checks: 2 \(Audit, Smoke\)/m);
  assert.match(text, /up to date: yes/);
  assert.match(text, /required reviews: 1/);
  assert.doesNotMatch(text, /WARNING/);
});

test('protection that requires reviews but no checks still warns', async () => {
  const body = { required_pull_request_reviews: { required_approving_review_count: 2 }, enforce_admins: { enabled: true } };
  const { result, text } = await run(['--protection'], { protection: ok(body) });
  assert.equal(result.code, 1);
  assert.match(text, /required status checks: none/);
  assert.match(text, /required reviews: 2/);
  assert.match(text, /^WARNING/m);
});

test('a ruleset that requires checks counts even when classic protection is absent', async () => {
  const rules = ok([{ type: 'pull_request', parameters: {} }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'Audit' }] } }]);
  const { result, text } = await run(['--protection'], { rules });
  assert.equal(result.code, 0);
  assert.match(text, /^required status checks: 1 \(Audit\)/m);
  assert.match(text, /ruleset/);
  assert.doesNotMatch(text, /WARNING/);
});

test('protection gh may not read is exit 2 with its message, unless a ruleset answers the question', async () => {
  const denied = refused('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)', '{"message":"Upgrade to GitHub Pro","status":"403"}');
  const unreadable = await run(['--protection'], { protection: denied });
  assert.equal(unreadable.result.code, 2);
  assert.match(unreadable.result.message, /Upgrade to GitHub Pro/);
  assert.doesNotMatch(unreadable.text, /WARNING/);
  const rules = ok([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Audit' }] } }]);
  const answered = await run(['--protection'], { protection: denied, rules });
  assert.equal(answered.result.code, 0);
});

test('a repository gh cannot resolve is exit 2', async () => {
  const { result } = await run(['--protection', '--repo', 'o/missing'], { repo: refused('GraphQL: Could not resolve to a Repository with the name \'o/missing\'. (repository)') });
  assert.equal(result.code, 2);
  assert.match(result.message, /Could not resolve to a Repository/);
});

test('--protection --json prints the repo, the branch, the checks and whether it warned', async () => {
  const { result, text } = await run(['--protection', '--json'], {});
  const parsed = JSON.parse(text);
  assert.equal(result.code, 1);
  assert.deepEqual(parsed, { repo: 'o/r', branch: 'main', requiredChecks: [], upToDate: null, requiredReviews: null, sources: { branchProtection: 'none', rulesets: 'none' }, warning: true });
});
