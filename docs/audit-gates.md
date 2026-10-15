# Audit gates: one rule

Chemical X has several places that decide whether a change is acceptable. They share one rule, defined in `cli/audit/gate-delta.js`:

> A change fails when, for any file, the number of violations of any rule is higher after the change than before it. Severity does not matter: LOW counts the same as CRITICAL.

This is the rule the audit ratchet (`chemx-ratchet.json`) applies repo-wide, where each rule's baseline is whatever `chemx-ratchet.json` records (0 in this repo). Without a ratchet file, `chemx verify` falls back to a severity gate that fails CRITICAL/HIGH only. The gates apply it to a change instead of to the whole repo.

| Gate | Compares | Fails on | Parity proof |
| :--- | :--- | :--- | :--- |
| Pre-commit hook (`chemx audit --staged-delta`) | staged content vs the same file at HEAD (renames compare with the old path) | any rule's count rising in a staged source file | `cli/audit/gate-parity.spec.js` |
| `chemx audit --delta-base=<ref>` / `chemx verify --changed --base=<ref>` | the changed source files at the merge-base of `<ref>` and HEAD vs their working-tree content (renames compare with the old path, untracked source files have no base) | any rule's count rising in a changed file | `cli/audit/base-delta.spec.js` |
| `chemx verify` ratchet step | a full scan vs `chemx-ratchet.json` | any rule above its recorded baseline | `cli/audit/gate-parity.spec.js` |
| `chemx team task done` | the task's target file now vs HEAD | the absolute CRITICAL/HIGH hazards (all hazards with `--strict`), plus any rule's count rising over HEAD | `cli/team/team-done-delta.spec.js` |
| `introducedViolations` in a `patch` or `write` result | the file before vs after that one edit | any rule's count rising in that file, so a second identical hazard is reported | `cli/audit/gate-parity.spec.js` |

## What is guaranteed

- A commit the hook accepts adds no violation of any rule in the staged source files, so it cannot raise the repo-wide count of any rule.
- A change that is green under `--delta-base=<ref>` or `verify --changed --base=<ref>` raises no rule's count in any changed source file, so it cannot raise any rule's repo-wide count even when the repo-wide ratchet is already red on other rules. That is what lets a change fix one rule without being held red by the rest.
- A legacy file that already has hazards is not blocked by them, only by new ones.
- On failure the hook prints one `RULE@file:line [SEVERITY]` entry per new hazard. `audit --delta-base` prints the same list under `Delta vs <ref>`; `verify --changed --base=<ref>` prints it under its `delta gate vs <ref>` step line and carries it in `audit.delta` of the `--json` summary.
- An unknown `<ref>` fails (`unknown base revision`, exit 1) instead of passing.

## What is not guaranteed

- `CHEMX_SKIP_PRECOMMIT=1 git commit` skips only the hook. Afterward `chemx verify` fails on those hazards only when a `chemx-ratchet.json` baseline exists and the rule is above it; without a ratchet it fails CRITICAL/HIGH only, so LOW and MEDIUM hazards pass.
- The comparison is per rule, so fixing one hazard does not offset a new hazard of a different rule: the rising rule fails.
- Rules adopted at a newer revision are recorded as baseline by the ratchet instead of failing. The hook compares HEAD and staged content under the current rules, so it is neutral on them as well.
- `introducedViolations` covers the one file an edit touched, not the repo; it does not include the line-budget warning, which is reported separately as `lineBudget`.
- The base delta judges the diff only: it does not make the repo-wide ratchet green, and `chemx verify` without `--base` still fails on a red ratchet. `verify --changed` without `--base` keeps the severity gate.
- An unstaged rename (a plain `mv`, not `git mv`) reaches the base delta as an untracked file with no base, so its inherited hazards count as new. `git mv` first and the old path is the base.
- Files that `isSourceFilePath` rejects are not audited by the hook or the base delta.

## Using the base delta

- `chemx audit --delta-base=<ref>` (or `--delta-base <ref>`) prints `Delta vs <ref>: ...` and exits 1 when a rule rises in a changed file or the ref is unknown; `--json` prints the result object (`isPassing`, `base`, `rev`, `checked`, `files`).
- `chemx verify --changed --base=<ref>` uses the same delta as the AST Architecture gate in place of the severity gate; typecheck and the affected specs run as before.
- `<ref>` is resolved to `merge-base(<ref>, HEAD)` when there is one, the starting point `verify --changed --base` already uses to list changed files, so work that landed on `<ref>` after branching is not read as undone.

## Related env switches

- `CHEMX_PRECOMMIT_GATE=grade` replaces the delta gate with the absolute grade gate on changed files (`--min-grade`, `--min-score`).
- `CHEMX_SKIP_PRECOMMIT=1` or `CHEMX_FORCE_COMMIT=1` skips the hook entirely.
