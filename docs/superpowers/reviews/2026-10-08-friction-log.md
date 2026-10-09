# chemx friction log (main loop)

- `chemx d --stat`: the output carries the "Diff compacted to --stat (exceeded 80 lines). Use cx d --full" footer, even though `--stat` was requested and the stat is 7 lines. The footer also references `cx`, which is not on PATH.
- `chemx q` piped output contains ANSI escapes. Stripping them needed `sed 's/\x1b\[[0-9;]*m//g'`.
- `chemx read --symbol` works well: about 378 tokens for runDiff. Keep.
- `chemx q -g "chemx-studio"` found nothing, because docs/superpowers/specs lives inside a submodule or is excluded. Literal search across submodules / docs needed a raw grep fallback.
- No chemx equivalent for `git check-ignore`, `ls`, or `find -newer`. These are fine as raw shell.
- MCP wrappers d/log/p/f/j ignore projectRoot/CHEMX_PROJECT_ROOT: DISPATCHER passes (p, cwd) but cmd-wrappers use process.cwd() -> they run against the server boot dir. Repro: boot server in $HOME with CHEMX_PROJECT_ROOT=<repo>, call {command:"p build"} -> "Key build not found".
- MCP serverInfo.version hard-coded "26.9.14" (package is 26.10.8-344): a client cannot tell which chemx it is talking to.
- 15 Claude sessions + 3 IDE servers all ran chemx 26.9.20 from apps/my-card-vault/node_modules (pre-Pass-1) via .mcp.json; CLI on PATH runs source 26.10.8-344. Version skew between MCP and CLI went unnoticed for 2+ days. Needs: version in serverInfo, stale-server notice when source/package version changes, doctor check.
- CLI cold start ~1.1s user CPU per call (`chemx p build`), MCP warm call 12ms: big gap for bursts of small queries.
- chemx test (CLI) picked vitest instead of the kit's own node --test script and also globbed .claude/worktrees/* copies; needed bypass to run cli/search.spec.js
- guard matched inside quoted strings and heredoc bodies; fixed with literal stripping (keep as a spec case for chemx hook claude-pre-tool)
