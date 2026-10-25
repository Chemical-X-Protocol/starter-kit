### Verify: a repo with its own test runner needs no node_modules (epic #6745, K9b #6770)

Reported by K9 (#6754, PR #20): `chemx test` learned the `tests/run-tests.mjs` harness runner of the WordPress plugins, but `chemx verify` still refused there with "Missing node_modules" (and climbed to the monorepo root's `package.json`), so a plugin could not use verify as its gate.

- In a directory where the harness runner is recognised, `chemx verify` runs three gates and prints one line for each: PHP syntax (`php -l` over the changed PHP files, `--all` for every one, `--base=<rev>` for the files changed since a revision), the Test Suite (the whole `node tests/run-tests.mjs`, on the job line) and the AST audit as before. There is no typecheck and no `node_modules` check. The exit code is the worst of the three (0, 1, 3).
- `php` missing from `PATH` skips the syntax step in one line (`phpLint.status` `skipped`, `PHP_NOT_FOUND`); it neither passes nor fails the run. A syntax error lists `file:line message` under the step line (five at most, with the count of the rest) and `phpLint.errors` in `--json`.
- `chemx verify --all` is a new flag and is refused in a project with no such runner (it would do nothing there). The help (`chemx verify --help`) and `commands-schema-verify.js` describe it.
- The audit step moved from `verify.js` to `verify-audit-step.js` so both pipelines share it; the package pipeline's output and JSON are unchanged.
- No PHP audit rules were added: those belong to the PHP audit epic (#6116 / #6484). Docs: `docs/audit-gates.md` ("A repo with its own runner"), `docs/test-lanes.md`.
