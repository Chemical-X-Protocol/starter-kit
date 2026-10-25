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
- Files that `isSourceFilePath` rejects are not audited by the hook or the base delta. That list (`cli/audit-preflight-git.js`) is separate from the full audit list in `cli/languages.js`: it is `.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.svelte` and, with PHP support, `.php`. It deliberately does not include `.mjs`, `.cjs`, `.cs`, `.py`, `.go`, `.rs`, `.java`, `.kt` or the C and C++ extensions, which `chemx audit` scans but the hook, `--delta-base`, `verify --changed` and `audit --git` skip.

## PHP in the gates

Details and defaults are in [php-wordpress.md](php-wordpress.md). What changes for the gates:

- PHP complexity, structural weight and nested-ternary findings are MEDIUM. They do not trip the absolute CRITICAL/HIGH filter, but a rise in their count still fails every per-rule delta gate and `task done`.
- A finding with `crossFile: true` (its evidence is in another file of the plugin) is exempt from the absolute CRITICAL/HIGH filter of `task done` and is gated by delta only.
- When the `task done` target is a PHP file inside a WordPress root, the gate also re-audits each file that depends on the target (at disk and at HEAD, with the target pinned to HEAD) and refuses when any rule count rises in one of them. Other files are read from disk, so this is a check, not a full pin of the plugin at HEAD.
- `task done` refuses a PHP target with `inconclusive-coverage` when its coverage is not `ast` (parser missing, minified, `--fast`, parse error). A low count for such a file says nothing.
- The delta gates run `git diff` in the current directory and do not enter submodules, so PHP delta gating applies only with the working directory inside the plugin repository. Only the kit has a chemx pre-commit hook; a plugin needs `chemx hook` to get one.

## A repo with its own runner

Task #6770. A repo whose `tests/run-tests.mjs` is a harness runner (see "A repo's own runner" in [test-lanes.md](test-lanes.md)) and that has no `package.json` of its own (the WordPress plugins `xophz-compass-gatekeeper` and `xophz-compass-xp`) has no `node_modules` to install and nothing to typecheck. `chemx verify` finds the runner from the directory you run it in (or `--dir`), also from `tests/` and under a parent that has a `package.json`, and runs three gates instead of the package pipeline. The summary prints one line per gate, in this order, and carries `phpLint`, `tests` and `audit` in `--json`; there is no `typecheck` entry.

| Gate | Runs | Pass | Fail |
| :--- | :--- | :--- | :--- |
| PHP syntax | `php -l` on each PHP file | every file parses, or there is no file to check | a file does not parse: the first five are listed as `file:line message` under the step line, with the count of the rest |
| Test Suite | `node tests/run-tests.mjs`, the whole runner, on the job line | the runner's verdict | a failing test; a run that registered no test is inconclusive (exit 3) |
| AST Architecture | the audit, as in any other project | the severity gate (or the ratchet, when `chemx-ratchet.json` exists) | the same rules as anywhere |

The exit code is the worst of the gates: 0 all passed, 1 any failed, 3 none failed but one could not prove its result. A gate that did not apply does not count.

Which PHP files. By default the `.php` files that differ from `HEAD` in the working tree (changed, staged and new), deleted files left out. `--base=<rev>` compares with the merge-base of `<rev>` and `HEAD` instead, as `chemx verify --changed --base=<rev>` does elsewhere. `--all` reads every `.php` file below the repo root. Files under `vendor/` and `node_modules/`, the `.git` and `.chemx` directories and nested repositories (a directory with a `.git` of its own, such as a submodule) are never read. When git cannot list the changes (not a repository, unknown base) every PHP file is read and the step line says why. Each file runs through `php -d display_errors=1 -d log_errors=0 -d html_errors=0 -l <file>` with a 30 second limit.

Without `php` on `PATH` the step is skipped in one line (`Skipped (php is not on PATH, so php -l did not run)`, `phpLint.status` `skipped`, `reason` `PHP_NOT_FOUND`). A skipped gate neither passes nor fails the run, so install PHP where the run is meant to prove syntax.

`--changed` narrows the audit to the changed source files, as everywhere; it does not narrow the runner or `php -l`. `--build` adds the build step as in other projects. `--all` is refused in a project that has no such runner, since it would do nothing.

Not guaranteed: `php -l` proves syntax only. PHP audit rules (security, WordPress, structure) are the PHP audit epic's (see [php-wordpress.md](php-wordpress.md)); until `.php` is registered for every audit caller, the audit gate of a PHP-only plugin sees no PHP. A runner that is not `tests/run-tests.mjs`, or that has a `test` script in a `package.json` of its own, is not recognised and the repo verifies as a package (and needs `node_modules`). Pinned by `cli/verify-harness.spec.js` and `cli/verify-php-lint.spec.js`.

## Using the base delta

- `chemx audit --delta-base=<ref>` (or `--delta-base <ref>`) prints `Delta vs <ref>: ...` and exits 1 when a rule rises in a changed file or the ref is unknown; `--json` prints the result object (`isPassing`, `base`, `rev`, `checked`, `files`).
- `chemx verify --changed --base=<ref>` uses the same delta as the AST Architecture gate in place of the severity gate; typecheck and the affected specs run as before.
- `<ref>` is resolved to `merge-base(<ref>, HEAD)` when there is one, the starting point `verify --changed --base` already uses to list changed files, so work that landed on `<ref>` after branching is not read as undone.

## Related env switches

- `CHEMX_PRECOMMIT_GATE=grade` replaces the delta gate with the absolute grade gate on changed files (`--min-grade`, `--min-score`).
- `CHEMX_SKIP_PRECOMMIT=1` or `CHEMX_FORCE_COMMIT=1` skips the hook entirely.
