# Starter-kit docs

Reference pages for behavior that specs pin. Design notes and plans live under `docs/superpowers/`.

| Page | Covers |
| :--- | :--- |
| [audit-gates.md](audit-gates.md) | The one rule every audit gate applies |
| [commit.md](commit.md) | `chemx commit`: path-limited commits, lease and task checks |
| [coordination-db.md](coordination-db.md) | The one team db per monorepo: how it is chosen (never the temp dir or `/`), what reads which db, repo attribution, `task list --all-repos/--repo`, `chemx team migrate` and the live runbook |
| [hooks.md](hooks.md) | Claude Code hooks |
| [team-audit-run.md](team-audit-run.md) | `chemx team audit-run` |
| [team-locks.md](team-locks.md) | File locks and leases: TTL, renewal, lapse, the commit guard |
| [test-lanes.md](test-lanes.md) | Test lanes and the agent test loop |
