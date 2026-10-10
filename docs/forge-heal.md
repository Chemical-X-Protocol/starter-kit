# Forge heal

`chemx heal` applies one blueprint (`docs/forge-blueprints.md`): it writes the piece, replaces each member with a call, verifies the result and restores every file byte for byte when any check fails. It never commits; the session that ran it commits, and `--undo` takes an uncommitted heal back.

```
chemx heal <bp-id|group-id> [--dry-run] [--fill=<hole>=<value> ...] [--spec-depth=<N>] [--json] --as=@handle
chemx heal --item=A7 [--dry-run] --as=@handle
chemx heal --undo=<run-id> --as=@handle
```

What it handles today: `extract-function` and `reuse` blueprints whose piece has a body, which in practice means groups matched to a library piece (A7 `readJsonOr`). It refuses everything else before writing (see Refusals). Code: `cli/forge/heal-*.js`.

## Sequence

1. **Plan in memory** (`heal-plan.js`). Every member is located again in the file as it is now, by its fp2 and its body hash (`bodyHash` on each call site: sha1 of the member text with each line trimmed). A member that only moved is found again and marked `moved`; a member whose body changed refuses with `BLUEPRINT_STALE`. Each member is then matched to the piece node by node (`heal-match.js`): a piece parameter matches any site expression, whose source slice becomes the argument; other nodes must be equal, except that `'utf8'` and `'utf-8'` count as one encoding, piece-local binders may be renamed, and an unused catch binder may differ or be missing. An argument that can have a side effect or throw (anything but names, literals, and plain object, array and template literals of those) refuses, because the call evaluates it before the piece runs. So does an argument that reads a name the member binds itself.
2. **Leases** (`heal-leases.js`). Every path in `locks` plus every planned file is checked for a foreign lease first; any foreign lease refuses the whole heal with `CHEMX_FILE_LOCKED` and nothing is leased or written. Then each path is leased as `--as`; a lease that is not granted releases the ones this heal took.
3. **Write** through `applyEdits` (parse check, V8 check, declaration-loss check, atomic writes with backups).
4. **Verify** (`heal-verify.js`), stopping at the first failure:
   - `parse`: every written file parses.
   - `audit`: no rule's violation count rises in any touched file, under the project config and under the atomic-strict profile (all rules). A new module counts from zero, so the piece itself must be clean.
   - `typecheck`: `sandbox` checks the piece alone under `chemx typecheck --sandbox` (checkJs, strict). `scoped` compares tsc diagnostics of the touched files before and after the edit, and runs only for files the project's root `tsconfig.json` typechecks (its `include` prefixes, the extension, `allowJs` and `checkJs`; `exclude` and project references are not read). The verdict always names both modes and says when one did not run.
   - `specs`: the specs that import a touched file or the piece module directly or through one more importer (`--spec-depth`, default 2, over the reverse import graph of `test-graph.js`), plus the blueprint's sibling specs, through `chemx test --json`. When they fail, the same specs run once more on the files as they were before the edit (restored, then the edit is written again); only failing test names that pass before the edit count against the heal. A failure whose test names cannot be read counts.
   - `post`: the members' fp2 occurs no more often than the piece exports it (1), and every touched file stays at 500 lines or fewer.
5. **Roll back** on any failure: the before texts are written back (a created module is deleted), every file is compared with its before text, and the run is recorded as `rolled_back` with the failing stage and up to 20 lines of output. The blueprint's status becomes `rejected` and the leases this heal took are released. If the files cannot be restored the outcome is `rollback_failed`.
6. **Success**: the search index and the Forge ledger rows of each file are re-synced, the run is recorded as `applied` with each file's before text and before and after sha1, and the blueprint becomes `healed`. The leases stay held for the commit (`chemx commit <files> --release`).

`--dry-run` runs step 1, previews the diff through `applyEdits` (which also refuses on a foreign lease), and reports the audit and the post-condition computed in memory. It leases and writes nothing.

`--undo=<run>` restores an `applied` run while every file it wrote still has the sha1 the heal left; otherwise it refuses with `HEAL_UNDO_DRIFT` and names the files. It leases all paths or none, like a heal. A committed heal is reverted with `git revert` instead.

## Span ops

`heal-ops.js` edits text by offsets and never reprints a file, so bytes outside the edited spans do not change.

- `replaceRange` replaces one member span; the replacement's later lines take the site's indentation. With `expectHash` it refuses a span whose body hash differs.
- `hoistComments` returns the comments inside a span, in source order; the heal writes them above the call.
- `addImport` merges into an existing import of the same module in the `{ a }`, `x` and `x, { a }` forms (a multi-line list stays multi-line). A namespace or side-effect import is never touched; a new declaration goes after the last import, in the file's quote and semicolon style. A name already bound to another module refuses with `HEAL_NAME_TAKEN`.
- `dropUnusedImports` removes the import specifiers the edit left with zero references (Babel scope), only those that had references before; already-unused imports and side-effect imports stay.
- `createModule` writes a new module; `insertExport` puts the piece after a host module's imports and merges the piece's imports into the host's.

Not built: `tabulate`, `scaffoldCapsule`, `collapseWrapper` (#4530), Vue SFC sites (#4533).

## Refusals

All of these are refused before anything is written, and recorded as a `refused` run:

| Code | When |
| :--- | :--- |
| `HEAL_KIND_UNSUPPORTED` | the blueprint kind is not `extract-function` or `reuse` |
| `BLUEPRINT_OPEN_HOLES` | a hole has no default and no fill (`--fill` or `chemx blueprint fill`) |
| `HEAL_DESIGN_HOLE` | a design hole is open |
| `BLUEPRINT_BEHAVIOR_DELTA` | the members differ in behavior (A4's polarity split) |
| `BLUEPRINT_NO_PIECE_BODY` | the piece has no body (groups without a library match, #4497) |
| `PIECE_MISSING`, `PIECE_QUARANTINED`, `PIECE_VERSION` | the library piece is absent, quarantined, or another version |
| `BLUEPRINT_STALE` | a member file is gone, no longer parses, or holds no unit with the member's fp2 and body hash; or a planned new module exists |
| `HEAL_SITE_MISMATCH` | a member does not match the piece (with the first difference) |
| `HEAL_PIECE_SHAPE` | the piece is not a one-statement exported function with plain parameters, or its statement does not return on every path |
| `CHEMX_FILE_LOCKED` | another handle leases a path |
| `HEAL_NO_HANDLE` | a real heal without `--as=@handle` |

## heal_runs

One row per attempt in `index.db`: `id` (`hr_` plus 10 hex), `blueprint_id`, `agent`, `outcome` (`dry_run`, `refused`, `applied`, `rolled_back`, `rollback_failed`, `undone`, `undo_failed`), `stage`, `code`, `output` (at most 20 lines), `verify_json`, `files_json` (before text and before/after sha1 per file), `diff`, `seq`, `created_at`. Fills stay in `blueprint_fills`.

## Measured

On the kit, 2026-10-09, single runs while other agents were running tests (wall clock from `time`):

- `chemx heal --item=A7 --dry-run`: 34 s. Most of it is rebuilding the ledger and the groups to resolve the item; the plan itself took about 3 s in a separate run.
- `chemx heal --item=A7 --as=@forge-p6`: 1 min 58 s, applied (run `hr_c6d5fa18b0`, blueprint `bp_51bd2c47cd74`). All five stages passed: 0 introduced violations in 8 files, sandbox typecheck 0 errors (scoped not run: the kit's tsconfig does not include `cli/`), 73 covering specs passed, 0 member instances left. It created `cli/fs-json.js`, replaced the 7 members, hoisted 3 comments and dropped `fs` only in `cli/hooks/project-status.js`. Committed as `refactor(patterns): readJsonOr from 7 sites [bp_51bd2c47cd74]`.
- An earlier applied run of the same heal ran only the 2 sibling specs because a missing `--spec-depth` parsed as 0. It was undone on the uncommitted checkout (byte-identical), the parser was fixed (`heal-cli.spec.js`), and the heal was run again as above.
- Undo on a copy of the kit (pre-heal files restored from the fixtures, a fresh index db): heal applied, `--undo` restored all 7 member files byte-identical (sha1 equal to the blueprint's `contentHash` values) and removed `cli/fs-json.js`.
- `cli/forge/heal-apply.spec.js` (9 tests, temp project seeded with copies of the A7 and A4 member files under `cli/forge/fixtures/heal/`) took 49 s in one run.

## Not built yet

- The exemplar fpBad guard, the resolution-piece verdict (`use piece <id>`), `rule_conflicts` rows and Friction filing on a rollback, and blocking the blueprint task (#4531).
- The MCP `heal` action (#4532).
- Same-directory siblings in the audit stage, for cross-file rules (#4534).
- Pieces for groups with no library match (#4497), so A4 is refused today.
- Heal does not register the piece as a project piece afterwards (P8).
