# Starter-kit docs

Reference pages for behavior that specs pin. Design notes and plans live under `docs/superpowers/`.

| Page | Covers |
| :--- | :--- |
| [audit-gates.md](audit-gates.md) | The one rule every audit gate applies (pre-commit hook, ratchet, `task done`, `patch`/`write`, and the base-ref delta `audit --delta-base` / `verify --changed --base`), what each guarantees and what it does not |
| [CHANGELOG.md](CHANGELOG.md) | What changed, grouped by area, with task ids, behavior changes and known issues |
| [commit.md](commit.md) | `chemx commit`: path-limited commits, lease and task checks |
| [coordination-db.md](coordination-db.md) | The one team db per monorepo: how it is chosen (never the temp dir or `/`), what reads which db, repo attribution, `task list --all-repos/--repo`, `chemx team migrate` and the live runbook |
| [forge-heal.md](forge-heal.md) | `chemx heal`: apply one blueprint under leases, verify it (parse, audit delta, typecheck modes, covering specs, post-condition), roll back byte for byte, `--dry-run`, `--undo`, heal_runs, refusal codes and measured runs |
| [forge-blueprints.md](forge-blueprints.md) | `chemx blueprint`: the chemx.blueprint/1 plan for one Forge group (kind table, placement, naming, library match, rejected members, holes and needs, fill), what it measured and what it does not do yet |
| [forge-library.md](forge-library.md) | `library/` entry format, the seed, how entries are verified, ruleset re-verify and quarantine, and what is not built yet |
| [forge-patterns.md](forge-patterns.md) | `chemx patterns --forge`: grouping, LGG holes, reject codes R1-R8, refinement, drift, ranking, the stored run and `patterns reject` |
| [hooks.md](hooks.md) | Claude Code hooks |
| [index-freshness.md](index-freshness.md) | Measured index sync timings (cold, warm, file at hand, after edits), with date, load and method |
| [php-wordpress.md](php-wordpress.md) | PHP and WordPress auditing: parse version vs `php.version`, `wordpress` key and detection, rule table with shipped defaults and `"on"`, annotations, the per-plugin index and its caps, coverage reasons, cross-file gate behavior, performance budgets, what does not cover PHP |
| [team-audit-run.md](team-audit-run.md) | `chemx team audit-run` |
| [team-dispatch.md](team-dispatch.md) | `chemx team dispatch --workflow`: task selection, routing per stage, the rendered build/review/repair/gate script (chemx renders it; the host runs it), run records |
| [team-locks.md](team-locks.md) | File locks and leases: TTL, renewal, lapse, the commit guard |
| [test-lanes.md](test-lanes.md) | Test lanes and the agent test loop; the line heavy jobs (full suite, typecheck, build) take turns in, light test runs, shared runs, `CHEMX_LIGHT_RESERVE` and `chemx test --slots` |
