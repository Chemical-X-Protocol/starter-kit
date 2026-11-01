### Fixed

- Pre-commit hooks: under `CHEMX_PRECOMMIT_GATE=grade`, `scripts/pre-commit.sh` and the installed hook built `--min-grade`/`--min-score` from `.chemx/config.json` or `CHEMX_MIN_GRADE`/`CHEMX_MIN_SCORE` and eval-ed the result, so a value such as `B;touch x #`, `$(...)` or a backtick payload ran at commit time. Both hooks now accept only `A+`, `A`, `B`, `C`, `D` or `F` (upper-cased first) and an integer 0-100, and fall back to the defaults otherwise (#254).
- `buildPreCommitHookScript` and `buildGitHubWorkflowScript` coerce the floors they render the same way, so a malformed `minGrade` or `minScore` at install time becomes `B` / `80` instead of shell text (#254).
