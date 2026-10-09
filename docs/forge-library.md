# Forge library (`library/`, `cli/library/`)

The kit ships `library/<facet>/<id>/` entries: concrete, rule-verified code that Forge matches against and,
later, heals toward. This page covers what exists now (task #2537). The library command, harvest,
project pieces and rule exemplars are later phases; see "Not built yet".

## Entry layout

| File | Content |
| :--- | :--- |
| `entry.json` | id, version, role (`piece`, `resolution`, `convention`, `exemplar`), facet, exportName, defaultModule, signature, params, holes, fp {l1,l2,l3}, aliases, canonicalFor, conflictsResolved, negatives, verifiedRuleset {version, revisionsHash}, status (`verified`, `quarantined`, `retired`), provenance. Guarded at runtime by `cli/library/entry-schema.js`. |
| `piece.<js\|ts\|vue>` | Fully filled code with default hole values. It parses, audits and typechecks as written; there is no placeholder syntax. |
| `piece.spec.<js\|ts>` | Behaviour tests on tmp dirs or real timers. No mock data. |
| `negative/*` | Code that must not match. A `noMatch` negative is a verbatim excerpt (with a `provenance:` first line) whose units must not share the piece fp. A `reports` negative must make the audit report the named rule. |
| `ambient.d.ts` | Optional; copied next to the piece only for the sandbox typecheck. |

`library/` is excluded from Forge detection (`cli/forge/exclusions.js`) and listed in package.json `files`.
The fp of an entry is the `fn` unit named by `exportName`, fingerprinted as if the piece lived at
`defaultModule`, by the same extractor the audit uses.

## Seed (what exists)

| Entry | Role | Notes |
| :--- | :--- | :--- |
| `node-js/read-json-or` | piece | try / JSON.parse / fallback; the catch carries a reason comment. Negatives: `cli/audit/ratchet.js:37-49`, `cli/workspace.js:10-16`. |
| `node-js/is-path-inside` | piece | Lexical containment. Unlike the inline `startsWith('..')` form it treats a `..name` directory as inside; migrate sites with that in mind. Negative: `cli/path-scope.js:103-114`. |
| `vue-ts/nullable-timer-handle` | resolution | Canonical for `CONTROL_FLOW_INLINE_BOOLEAN` and `TIMER_DISCIPLINE`: `clearTimeout(timerId)` with no branch. Taken from `src/ui/composables/useSelfCleaningTimeout.ts`. |

nullable-timer-handle negatives: the const-alias form (`const id = timerId; const hasTimer = id !== null; if (hasTimer) clearTimeout(id)`) reports `TIMER_DISCIPLINE`; the inline guard (`if (timerId !== null) clearTimeout(timerId)`) reports `CONTROL_FLOW_INLINE_BOOLEAN`.
That inline-guard hazard ends with `Canonical: library/vue-ts/nullable-timer-handle/piece.ts`, added by
`narrowsMutableRef` (`cli/audit/mutable-ref-predicate.js`): the test compares a `let` binding or a member to
null/undefined and the branch uses it. Detection is unchanged, so there is no ruleset bump. The remedy names a file path because the
library command does not exist yet (#4446); library.spec checks the path exists.

## Verification (`cli/library/library.spec.js`, run by `npm test`)

Per entry, `verifyItem(item, { scope: 'all' })` runs: schema, parse, audit (every rule, `atomic-strict`, zero
violations), autofix no-op, negatives, holes located in the piece, recomputed fp equals entry.json, own aliases match,
sandbox typecheck (`runSandboxTypecheck`: `tsc --strict`, checkJs for JS), and `piece.spec` under `node --test`.
The typechecker is `tsc`; `vue-tsc` is not used (no `.vue` piece exists yet and `.vue` pieces skip the typecheck).

## Ruleset handling (`cli/library/reverify.js`)

`reverifyLibrary(items, { write, fileTask })` skips entries whose stamp equals `currentRuleset()` (RULESET_VERSION
plus a hash of RULE_REVISIONS and the registered rule ids). Otherwise it runs only the rule-dependent checks (parse,
audit, autofix, negatives). A pass re-stamps and sets `verified`; a failure sets `quarantined` and, once per newly
quarantined entry, files `Library: <id> fails <RULE> after ruleset <v>` (needs standard, parent #2532) through
`fileLibraryTask`, which is idempotent by title. Blueprint ids do not include the ruleset (engine doc), and reverify
touches only `entry.json`. Nothing calls `reverifyLibrary` automatically yet (wiring belongs to the library command, #4446). library.spec
covers the function end to end up to that point: `currentRuleset({ revisionTable, version })` changes its hash when the
revision table is edited, and the re-verify then re-stamps or quarantines.

## Not built yet

The library command (list, show, verify, sync, add), fixtures-sync and fixture-gen with `library/exemplars/`,
the interaction matrix across rules, `rule_conflicts` rows, the remaining seed entries (relative-if-inside,
git-root, visible-poller, capsule-controller-return, toc-view, framework-mirror), and a spec that open blueprints
survive a bump (no blueprint ids exist yet). Each is a follow-up task under #2532.
