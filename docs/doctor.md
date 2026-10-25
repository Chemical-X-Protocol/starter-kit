# chemx doctor

`chemx doctor [--fix] [--fetch] [--json] [--root=<dir>]` is one read-only report on how this machine runs chemx. Each line is `ok`, `FAIL` or `??` (inconclusive); the exit code is 0, 1 or 3 for the worst of them. `--fix` repairs only hooks and the `.mcp.json` launch (idempotent, with backups); it never edits shims and never kills a process.

## Kit, origin and CI pin

Three lines explain why a local audit and CI can disagree when the chemx on PATH is a working copy and CI runs `npx chemx@<pin>`.

| Check | Says | Status |
| :--- | :--- | :--- |
| `kit` | The version, short commit and branch of the kit that is running, and how many tracked files are modified (`kit 26.10.25-1220 @ f93ef8a on main`). An npm-installed copy, or a kit directory that is not the top of its own git repo, reads `installed copy, not a git checkout`. | always `ok` |
| `kit-origin` | How far HEAD is from `origin/main`: `in step`, or `N ahead, M behind`. It reads the **local** `origin/main` ref, so it needs no network and cannot fail offline. `--fetch` runs `git fetch origin main` first and marks the line `(fetched)`; a failed fetch is appended to the line and makes it `??`, never a `FAIL` of its own. | behind: `FAIL`; ahead (commits CI and npx do not run) or no ref: `??`; in step: `ok` |
| `ci-pin` | The chemx version `.github/workflows/*.yml` pins: a `CHEMX_VERSION: x` line, else a literal `chemx@x`. | differs from the running kit: `FAIL` and the `npx chemx@<pin>` command that reproduces CI; same or no pin: `ok` |

## Stale MCP servers

Running chemx MCP servers are read from `/proc` (Linux). Servers that are current are only counted. Stale ones (kit code changed after they started, or another version than this CLI) are grouped **by project root**, one line per root plus one restart hint:

```
FAIL mcp-servers 24 running, 24 stale in 4 project roots; doctor never kills processes
                 15x /repo: code changed since start; sessions 0070d072-..., 222c272d-..., 2756ecc6-..., +12 more
                    restart: in each of those sessions run /mcp and reconnect chemical-x, or end the session
```

The session comes from `CLAUDE_CODE_SESSION_ID` in `/proc/<pid>/environ`. A group with exactly one session also names its transcript (`<claude home>/projects/*/<id>.jsonl`, found when the file exists). A server whose environment exposes no session id is shown with its parent pid, and an Antigravity editor is named as such. `--json` carries the same groups under `groups`.

## Jest layout under pnpm

`jest-deps` appears only for a pnpm project (`node_modules/.pnpm/node_modules` exists) whose jest config names bare modules. It reads `jest.config.json`, the `jest` key of `package.json`, or (as text, never executed) a `jest.config.{js,cjs,mjs,ts}`, and collects the `preset` package, `snapshotSerializers` and bare `transform` values. A preset file is scanned as text for its own `snapshotSerializers`, following relative `require`s of parent presets (vue-cli's `typescript-and-babel` preset lists `jest-serializer-vue`). Jest resolves those names from the project root, so a package that exists only under `node_modules/.pnpm/node_modules` is found only through `NODE_PATH`:

- `??` when such a package is not covered by the current `NODE_PATH`: the line names the package, where the config names it, and `NODE_PATH=<root>/node_modules/.pnpm/node_modules` for a raw jest run. `chemx test` puts that directory on `NODE_PATH` itself (task #6754), so this is a flag for anyone running jest directly, not a failure of the project.
- `ok` when everything resolves from `node_modules`, or when `NODE_PATH` already covers the `.pnpm` directory.

Doctor reads the config statically; the test runner (`cli/build/pnpm-store-path.js`) decides the same question by asking jest, and the two are independent.
