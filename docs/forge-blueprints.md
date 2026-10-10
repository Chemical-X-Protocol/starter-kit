# Forge blueprints

`chemx blueprint` turns one accepted Forge group into a plan: what kind of extraction it is, what the piece is called and where it lives, which call sites it replaces, which near misses it leaves alone, and which judgment calls are still open. It plans only. Nothing is edited; `chemx heal` applies a blueprint (`docs/forge-heal.md`).

```
chemx blueprint <group-id|bp-id> [--json]
chemx blueprint --item=A7 [--json]
chemx blueprint holes <target>
chemx blueprint fill <target> <hole>=<value> ... --as=@handle
```

The target is a group id prefix from `chemx patterns --forge`, a stored `bp_` id, or a ground-truth item (`--item`). An item resolves to the surfaced group that touches the most of its labeled anchors, with the fewest members outside the item, then the lower rank. Showing a blueprint refreshes the fingerprint ledger, builds the blueprint and stores it by id in `index.db` (`blueprints`); fills go to `blueprint_fills`.

## What is in a blueprint

Schema `chemx.blueprint/1`, printed as canonical JSON (sorted keys, LF, no timestamps). `id` is `bp_` plus the first 12 hex characters of sha256 over the body without `id` and status, so the same group in the same state always prints the same bytes. The body depends on the extractor version, the members' content hashes and offsets, the LGG summary, the placement and the library piece version. It does not depend on the ruleset, the clock or input order (the build sorts members, drift, rows, groups and library entries itself). Fills are kept apart from the body, so a fill never changes the id.

| Field | Meaning |
| :--- | :--- |
| `kind` | `extract-function`, `reuse`, `tabulate`, `extract-component`, `extract-composable`, `extract-hook` or `advisory` |
| `piece` | name, module, whether the module is new, where the placement came from, the library piece (`fromPiece`), signature, params, and the library piece's code as `body` |
| `callSites` | file, line range, body hash (the member text with each line trimmed, so heal tells a moved member from a changed one), file content hash, member fp2 and the import to add |
| `evidence` | instance and file counts, mass, E, hole ratio, shared anchors and `rejectedMembers` |
| `drift`, `holes` | similar spans that differ, and the open and defaulted judgment calls |
| `needs`, `autoApplicable` | the work tier and whether every hole has a default |

### Kind table

A facet only gets the kinds its language and runtime can carry (`cli/forge/placement.js`).

- A template group becomes `extract-component` in a vue, react or svelte facet, and `advisory` in a plain one.
- A composable (vue facet) or hook (react facet) needs the unit to call that framework's APIs: an `import:vue#ref`-style anchor or a `call:` of `ref`, `computed`, `watch`, `onScopeDispose` and the like for vue, `useState`, `useEffect` and the like for react. The same code in a plain facet, or in the other framework's facet, stays `extract-function`.
- A W group is `tabulate`; a group with no placement is `advisory`; a matched library piece that already exists in the project is `reuse`.
- The module's extension comes from the members' own (a `.js` group never gets a `.ts`, `.tsx` or `.vue` module). Every `cli/**` file is a plain js facet, so no `cli/**` blueprint can be a hook, a composable or a component.

### Placement

1. An existing same-package module that already holds at least 2 instances of the idiom (members plus drift spans, plus spans other accepted groups report over the same code) hosts the piece. This beats a library default module.
2. Else the matched library piece's `defaultModule`, when it is in the members' package root and extension family.
3. Else a new module in the members' deepest common directory, named from the piece name.

Members that span package roots have no placement: the blueprint is `advisory` with a `placement` design hole at tier deep.

### Naming

A matched library piece names itself. Otherwise the name is built from the subtokens more than half of the members' own or enclosing function names share (a verb first), else from the shared call anchors (`is` prefix for an expression). A name that a member file or the piece module already declares is never offered. The name is a `name` hole at tier light, with candidates.

### Library match

A group matches a library entry when the entry's piece function and the group share the same set of non-literal anchors (called names and the modules or globals they use; an imported name and the same global count once), at least 3 of them, in the same facet. Fingerprints are not used for this: a site is a statement inside a function and the piece is the whole function, so the fps differ even for the same code. A group that is only a fragment of a piece (it has fewer anchors) does not match.

### Rejected members

`evidence.rejectedMembers` lists near misses the blueprint must not touch: a unit of the group's root type that uses every non-literal anchor of the members at a comparable size (0.5 to 5 times) but whose pair LGG with the home member fails R3 (a hole reads a binder the unit introduces, as when a catch hands its error back), or, for a try group, a function with no try at all that throws where the members recover (R4). Other pair failures (size or anchor differences) are not listed. The list is complete up to 40 entries; the summary shows the first 8.

### Holes and needs

- `name` (light) and `doc` (wording, light) have defaults. The `doc` default is the library piece's wording or a plain sentence from the name.
- `drift-adoption` (decision, standard) is open whenever the blueprint has drift: adopt the piece at the drifting spans, keep them, or skip.
- `variant-<hole>` (standard) for each transform hole. `placement` (design, deep) when there is no placement; a design hole takes no fill.
- `needs` is the highest of the kind floor (function, reuse and in-file table light; component, composable and hook standard; advisory deep), the hole tiers, the file count (7 to 15 files standard, more than 15 deep), drift or behavior change, and a site set with no sibling spec. "No sibling spec" means none of the member files has a `.spec` or `.test` file next to it; it is a cheap proxy for the reverse-import spec search the engine doc describes.
- `autoApplicable` needs light, every hole defaulted, no drift and no behavior change.

`fill` validates before it records: a name is one free identifier (not declared in the module or a member file), a wording is at most 120 characters with no em dash, a decision is one of its candidates.

## Not built yet

- The piece `body` is the library piece's code for a matched group. For any other group it is `null`: writing it from the home member and the LGG belongs to the heal engine (P6).
- `behaviorDelta` is always empty, and `children` and `unblocks` are empty. Call sites do not carry the replacement arguments.
- Hole tasks are not created (`--task`), and `fill` does not close any. There is no MCP `blueprint` action, and the roadmap, prompts and `patterns` listing do not mention blueprints yet.
- The near-miss search reads candidate files, so a blueprint takes tenths of a second to build.

## Measured

On the kit's own index, 2026-10-09, one run, warm cache, under other agents' load (`node` script around `buildBlueprint`; wall clock): 42,788 ledger rows, 1,145 accepted groups. Reading the ledger took 0.63 s, building the context 0.40 s, one blueprint (the A7 group) 0.61 s, the 20 top-ranked groups 1.46 s together. Their kinds were 18 `extract-function` and 2 `tabulate`; needs were 1 light, 13 standard and 6 deep. These are single measurements, not a benchmark.

On the ground-truth project (the P1 fixture excerpts written back to their files, with the truncated `cli/audit/ratchet.js` excerpt closed so it parses; `cli/forge/blueprint.spec.js`), the A7 blueprint is byte-identical across 3 builds and a build over shuffled ledger rows, instances, drift, groups and library entries; it names `readJsonOr` in `cli/fs-json.js` and lists `cli/audit/ratchet.js`, `cli/doctor/check-mcp.js`, `cli/workspace.js` and `cli/commands/cmd-wrappers-json.js` as rejected. A4's piece lands in the existing `cli/path-scope.js` with a `drift-adoption` hole at standard. On the live kit `chemx blueprint --item=A7 --json` gave the same sha1 on 3 consecutive runs and lists the same four B8 files among 18 rejected members; `--item=A4` hosts in `cli/path-scope.js` with 3 drift spans.
