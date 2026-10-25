/**
 * Chemical X Protocol: `chemx ci --protection [--repo owner/name]` (#6760, K15). Read-only: asks GitHub
 * whether the default branch requires status checks, through branch protection
 * (`gh api repos/{owner}/{repo}/branches/{branch}/protection`) and through rulesets
 * (`gh api repos/{owner}/{repo}/rules/branches/{branch}`). With none required, `gh pr merge --auto`
 * merges at once, because nothing makes GitHub wait (kit PR #12), so the report warns and exits 1.
 */
import { MISSING_GH, jsonOf, firstLine } from './ci-gh.js';

const NOT_PROTECTED = /Branch not protected/i;

const readRepo = (gh, repo) => {
  const reply = gh(['repo', 'view', ...(repo ? [repo] : []), '--json', 'nameWithOwner,defaultBranchRef']);
  const found = reply.ok ? jsonOf(reply) : null;
  const hasBranch = Boolean(found?.nameWithOwner) && Boolean(found?.defaultBranchRef?.name);
  const failure = reply.missing ? MISSING_GH : `gh repo view failed: ${firstLine(reply)}`;
  return hasBranch ? { name: found.nameWithOwner, branch: found.defaultBranchRef.name } : { error: failure };
};

const classic = (body) => {
  const required = body.required_status_checks ?? {};
  const contexts = [...(required.contexts ?? []), ...(required.checks ?? []).map((entry) => entry.context)];
  return {
    kind: 'on',
    checks: contexts,
    upToDate: body.required_status_checks ? Boolean(required.strict) : null,
    reviews: body.required_pull_request_reviews ? Number(body.required_pull_request_reviews.required_approving_review_count ?? 0) : null
  };
};

const NO_RULES = { kind: 'none', checks: [], upToDate: null, reviews: null };

const readClassic = (gh, repo) => {
  const reply = gh(['api', `repos/${repo.name}/branches/${repo.branch}/protection`]);
  const body = reply.ok ? jsonOf(reply) : null;
  const isAbsent = !reply.ok && NOT_PROTECTED.test(`${reply.stderr}${reply.stdout}`);
  if (body) return classic(body);
  return isAbsent ? NO_RULES : { ...NO_RULES, kind: 'unreadable', message: reply.missing ? MISSING_GH : firstLine(reply) };
};

const fromRuleset = (rules) => {
  const byType = (type) => rules.find((rule) => rule.type === type)?.parameters;
  const status = byType('required_status_checks');
  const review = byType('pull_request');
  return {
    kind: rules.length > 0 ? 'on' : 'none',
    checks: (status?.required_status_checks ?? []).map((entry) => entry.context),
    upToDate: status ? Boolean(status.strict_required_status_checks_policy) : null,
    reviews: review ? Number(review.required_approving_review_count ?? 0) : null
  };
};

const readRulesets = (gh, repo) => {
  const reply = gh(['api', `repos/${repo.name}/rules/branches/${repo.branch}`]);
  const rules = reply.ok ? jsonOf(reply) : null;
  return Array.isArray(rules) ? fromRuleset(rules) : { ...NO_RULES, kind: 'unreadable' };
};

const firstKnown = (...values) => values.find((value) => value !== null) ?? null;

const buildReport = (repo, protection, rulesets) => {
  const requiredChecks = [...new Set([...protection.checks, ...rulesets.checks])];
  const hasChecks = requiredChecks.length > 0;
  return {
    repo: repo.name,
    branch: repo.branch,
    requiredChecks,
    upToDate: hasChecks ? firstKnown(protection.upToDate, rulesets.upToDate) : null,
    requiredReviews: firstKnown(protection.reviews, rulesets.reviews),
    sources: { branchProtection: protection.kind, rulesets: rulesets.kind },
    warning: !hasChecks
  };
};

const WARNING = 'WARNING: gh pr merge --auto merges at once on this branch: nothing makes GitHub wait for a check. Require the checks (Settings > Branches, or a ruleset; see docs/ci.md in the chemx kit), or merge by hand after `chemx ci --wait`.';

export const renderProtection = (report) => {
  const checks = report.requiredChecks.length > 0 ? `${report.requiredChecks.length} (${report.requiredChecks.join(', ')})` : 'none';
  const upToDate = report.upToDate === null ? '' : `; up to date: ${report.upToDate ? 'yes' : 'no'}`;
  const reviews = report.requiredReviews === null ? 'none' : String(report.requiredReviews);
  const sources = `sources: branch protection ${report.sources.branchProtection}, rulesets ${report.sources.rulesets}`;
  return [
    `${report.repo} ${report.branch}`,
    `required status checks: ${checks}${upToDate}; required reviews: ${reviews}`,
    sources,
    ...(report.warning ? [WARNING] : [])
  ].join('\n');
};

/** @returns {{ code: number, message?: string, report?: object }} 0 checks required, 1 none required (warned), 2 unreadable */
export const runProtection = (opts, env) => {
  const repo = readRepo(env.gh, opts.repo);
  if (repo.error) return { code: 2, message: repo.error };
  const protection = readClassic(env.gh, repo);
  const rulesets = readRulesets(env.gh, repo);
  const report = buildReport(repo, protection, rulesets);
  const isUnreadable = protection.kind === 'unreadable' && report.warning;
  if (isUnreadable) return { code: 2, message: `cannot read branch protection for ${repo.name} ${repo.branch}: ${protection.message}` };
  env.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderProtection(report)}\n`);
  return { code: report.warning ? 1 : 0, report };
};
