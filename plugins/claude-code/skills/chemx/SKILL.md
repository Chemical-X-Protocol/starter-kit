---
name: chemx
description: Use chemx (Chemical X) instead of raw test runners, typecheckers, git diff/log and whole-file source reads in a chemx project. Load when running tests, typechecks, lint or builds, inspecting diffs or history, reading or searching source, or when the chemx guard denies a Bash command.
---

# chemx in Claude Code

The chemx guard denies raw runners and source reads and names the replacement. Use these from the start:

| Instead of | Run |
|---|---|
| `vitest`, `jest`, `npm test` | `chemx test [file] [--filter=<name>]` |
| `tsc`, `vue-tsc`, `npm run typecheck` | `chemx typecheck` |
| `eslint`, `npm run lint` | `chemx lint [path] [--fix]` |
| `npm run build`, `vite build` | `chemx build -- <build command>` |
| `git diff`, `git log` | `chemx d [args]`, `chemx log [-n N]` |
| `cat`/`head`/`sed -n` on source | `chemx read <file> --outline`, `--symbol=<name>`, `--start=N --end=M`, or the native Read tool |
| symbol search | `chemx q "<name>"` (literal: `chemx q -g "<text>"`) |

- `chemx verify` runs audit, typecheck and tests together. Exit codes: 0 pass, 1 fail, 3 inconclusive (nothing proved it; never treat as pass).
- Scripting forms stay allowed: `git diff --name-only`, `git log --format=...`, reads of logs, JSON and files outside the repo.
- If chemx truly cannot do the job, append `# chemx-bypass: <reason>` to the Bash command. It is allowed and logged; `chemx friction` shows the log.
- After an edit, hazards in that file come back as context with x-atoms helper hints. Fix them in the same change.
- When MCP answers look stale or wrong, run `chemx doctor` (it lists running chemx MCP servers with their versions).
