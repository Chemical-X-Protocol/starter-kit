# chemx ci

`chemx ci` reads a pull request's checks and merge state through `gh`, so an agent does not shell out to
`gh pr checks`, `gh pr view` or a `sleep` loop. `chemx ci --protection` tells whether the default branch makes
GitHub wait for checks at all. Both are read-only: nothing here changes a pull request or a repo setting.

```
chemx ci [<pr number | branch | url>] [--repo owner/name] [--wait [--timeout=30m]] [--json]
chemx ci --protection [--repo owner/name] [--json]
```

With no argument it takes the pull request of the current branch. `--repo` names the repository when the
directory is not a clone of it; a URL names its own.

## Output

One line per check (state, duration, name), then one line of merge state. Real output, kit PR #23:

```
pass         21s  Chemical X Architecture & Line Budget Audit
pass       3m59s  Framework Scaffolding Smoke Test
PR #23 merged: merge state UNKNOWN, mergeable UNKNOWN, auto-merge off, review none
```

- State is `pass`, `FAIL`, `cancel`, `pending` or `skipped`. A failed or cancelled check also prints its run link.
- A duration with a trailing `+` is a check still running (its age so far); `queued` has not started.
- The merge line comes from `gh pr view --json mergeStateStatus,mergeable,autoMergeRequest,reviewDecision`:
  `auto-merge on (squash)` means auto-merge is requested, `review none` means no review decision exists.
- `chemx ci` lists every check on the pull request, required or not. Which checks GitHub requires is what
  `--protection` reads.

When GitHub reports no checks, the output says so and still prints the merge line. Kit PRs sometimes have none for
the first minutes (PR #16 never showed any to `gh pr checks`):

```
no checks reported
PR #16 merged: merge state UNKNOWN, mergeable UNKNOWN, auto-merge off, review none
```

## Exit codes

| Code | Meaning |
| :--- | :--- |
| 0 | every check passed (skipped checks do not count against it) |
| 1 | a check failed or was cancelled |
| 3 | a check is pending, or no checks are reported yet; also a `--wait` that ran out of time |
| 2 | it could not read: `gh` missing, pull request or repository not found, bad arguments; the reason is on stderr |

A failure outranks a pending check: one failed check and two pending ones exit 1.

## --wait

`chemx ci <pr> --wait` polls every 30 s. It prints the full block once, then only the lines that changed (a check
that moved from `pending` to `pass`, a changed merge line), and stops at the first failure or when every check
passed. `--timeout=<dur>` takes `90`, `90s`, `5m` or `2h` (default 30m); on timeout it prints the checks still
pending and exits 3. With no checks reported it keeps polling until some appear. With `--json` it prints nothing
until the end, then one object (`verdict`, `pr`, `checks`, `merge`, and `timedOut` when it timed out).

The result is true as of the last poll. A check can still be re-run afterwards.

## --protection

`chemx ci --protection` asks GitHub which status checks the default branch requires, from classic branch
protection (`gh api repos/{owner}/{repo}/branches/{branch}/protection`) and from rulesets
(`gh api repos/{owner}/{repo}/rules/branches/{branch}`). Real output for the kit's own repository on 2026-10-25:

```
Chemical-X-Protocol/starter-kit main
required status checks: none; required reviews: none
sources: branch protection none, rulesets none
WARNING: gh pr merge --auto merges at once on this branch: nothing makes GitHub wait for a check. ...
```

| Code | Meaning |
| :--- | :--- |
| 0 | at least one status check is required |
| 1 | none is required; the warning is printed |
| 2 | gh could not read the protection (for example no permission) and no ruleset answered |

**Why it matters.** `gh pr merge --auto` means "merge when the requirements are met". On a branch that requires
nothing, there is nothing to wait for, so GitHub merges immediately: kit PR #12 merged the moment auto-merge was
switched on, before its checks had run. Until the branch requires checks, merge by hand after
`chemx ci <pr> --wait` exits 0.

**Recommendation: protect `main`.** Require the kit's two jobs, `Chemical X Architecture & Line Budget Audit` and
`Framework Scaffolding Smoke Test`. In the GitHub UI: Settings, Branches, add a branch protection rule for `main`,
"Require status checks to pass before merging", and select both. The same through the API (the repository owner
runs this; chemx never changes repository settings):

```
gh api -X PUT repos/Chemical-X-Protocol/starter-kit/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["Chemical X Architecture & Line Budget Audit","Framework Scaffolding Smoke Test"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
JSON
```

Re-run `chemx ci --protection` afterwards: it should exit 0 and list both checks.

## What it does not guarantee

- It reads `gh` output as of one moment. A pull request that was green can be re-run or get a new check.
- Reading branch protection needs permission on the repository; without it the report is exit 2 unless a ruleset
  answers. Rulesets are readable by anyone who can read the repository.
- The merge state words (`CLEAN`, `BLOCKED`, `BEHIND`, `DIRTY`, `UNSTABLE`, `UNKNOWN`) are GitHub's. A merged or
  closed pull request reports `UNKNOWN`.
- `gh` must be installed and signed in. The runner is one module (`cli/ci-gh.js`); specs replace it, so nothing in
  the specs talks to GitHub.
