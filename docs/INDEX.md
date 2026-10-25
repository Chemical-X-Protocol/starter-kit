# Starter-kit docs

Reference pages for behavior that specs pin. Design notes and plans live under `docs/superpowers/`.

| Page | Covers |
| :--- | :--- |
| [agent-workspace.md](agent-workspace.md) | `chemx scratch` (a git-ignored directory per agent), `chemx worktree add/remove` (`--link-modules` builds a real `node_modules` of symlinks, `--install`, the index seeded from the main checkout's rows for unchanged files, squash-aware branch cleanup) and `chemx mutate` (apply a sed substitution or diff, run a command, restore byte for byte; exit codes and what it does not cover) |
| [audit-gates.md](audit-gates.md) | The one rule every audit gate applies (pre-commit hook, ratchet, `task done`, `patch`/`write`, and the base-ref delta `audit --delta-base` / `verify --changed --base`), what each guarantees and what it does not |
| [CHANGELOG.md](CHANGELOG.md) | What changed, grouped by area, with task ids, behavior changes and known issues. New entries are written as one file per change in `changelog.d/` (see its README.md) and folded in with `chemx changelog` |
| [ci.md](ci.md) | `chemx ci`: a pull request's checks and merge state through gh, exit codes 0/1/3/2, `--wait`, and `--protection` (does the default branch require checks; why `gh pr merge --auto` merged kit PR #12 at once; how to protect `main`) |
| [commit.md](commit.md) | `chemx commit`: path-limited commits, lease and task checks |
| [coordination-db.md](coordination-db.md) | The one team db per monorepo: how it is chosen (never the temp dir or `/`), what reads which db, repo attribution, `task list --all-repos/--repo`, `chemx team migrate` and the live runbook |
| [doctor.md](doctor.md) | `chemx doctor`: the kit commit, origin drift and CI pin lines, stale MCP servers grouped by project root with the Claude session behind each, the pnpm jest layout check, `--fetch` and exit codes |
| [forge-heal.md](forge-heal.md) | `chemx heal`: apply one blueprint under leases, verify it (parse, audit delta, typecheck modes, covering specs, post-condition), roll back byte for byte, `--dry-run`, `--undo`, heal_runs, refusal codes and measured runs |
| [forge-blueprints.md](forge-blueprints.md) | `chemx blueprint`: the chemx.blueprint/1 plan for one Forge group (kind table, placement, naming, library match, rejected members, holes and needs, fill), what it measured and what it does not do yet |
| [forge-library.md](forge-library.md) | `library/` entry format, the seed, how entries are verified, ruleset re-verify and quarantine, and what is not built yet |
| [forge-patterns.md](forge-patterns.md) | `chemx patterns --forge`: grouping, LGG holes, reject codes R1-R8, refinement, drift, ranking, the stored run and `patterns reject` |
| [hooks.md](hooks.md) | Claude Code hooks |
| [index-freshness.md](index-freshness.md) | Measured index sync timings (cold, warm, file at hand, after edits), with date, load and method |
| [php-wordpress.md](php-wordpress.md) | PHP and WordPress auditing: parse version vs `php.version`, `wordpress` key and detection, rule table with shipped defaults and `"on"`, annotations, the per-plugin index and its caps, coverage reasons, cross-file gate behavior, performance budgets, what does not cover PHP |
| [search.md](search.md) | `chemx q`: the text fallback when no symbol matches, path scoping, `--regex` (the RE2 subset), `-l` files only, `-o --unique` distinct matched text, JSON and MCP fields |
| [team-audit-run.md](team-audit-run.md) | `chemx team audit-run` |
| [team-dispatch.md](team-dispatch.md) | `chemx team dispatch --workflow`: task selection, routing per stage, the rendered build/review/repair/gate script (chemx renders it; the host runs it), run records |
| [team-locks.md](team-locks.md) | File locks and leases: TTL, renewal, lapse, the commit guard |
| [team-tokens.md](team-tokens.md) | `chemx team tokens --epic`: cost, tokens and wall time per epic over its children, where each child's figures come from, and what unknown means |
| [test-lanes.md](test-lanes.md) | Test lanes and the agent test loop; the line heavy jobs (full suite, typecheck, build) take turns in, light test runs, shared runs, `CHEMX_LIGHT_RESERVE` and `chemx test --slots` |
