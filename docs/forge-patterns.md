# Forge groups: `chemx patterns --forge`

Tasks #2536 (Forge P3) and #2532 (the Forge epic). This page says what the Forge grouping run does after the fingerprint ledger is current, what it stores, and what its output means. The design is `docs/superpowers/specs/2026-10-09-chemx-forge-engine.md` (sections 5-8); this page covers what the code does today.

The plain `chemx patterns` is still the legacy detector, which the roadmap reads. Everything here runs behind `--forge` until P5 swaps the surfaces.

## Commands

| Command | Does |
| :--- | :--- |
| `chemx patterns --forge [dir] [--include-tests] [--idioms]` | Refreshes the ledger, groups it, judges and ranks every group, stores the run in `.chemx/index.db`, and prints one line per ranked group (top 20, `--limit=<N>`), then one rejected-summary line by reason code |
| `... --rejected` | Also lists every rejected and suppressed group with its reason and all of its failing codes |
| `... --explain=<id>` | One group: its holes (kind and up to 3 sides each), captures, members, drift and evicted units, codes and score |
| `... --path=<P> --kind=<K> --json` | Filters (`--path=W`, `--kind=fn`), or the whole run as JSON |
| `chemx patterns reject <id> --reason="..." --as=@handle` | Suppresses a stored group and posts the decision to the team feed |
| `chemx patterns --groups` | The run as JSON, in the shape the ground-truth scorer reads |
| `chemx patterns --score=<labels.json> --forge` | Scores the run against the ground truth |

A listing line reads `rank. id path kind | sites/files | E mass holes | first site | drift, dependsOn, evicted counts`.

## The run

1. **Grouping** (`forge-groups.js`): N1 exact buckets at fp1, fp2 and fp3, N2 windows, N3 same-name near misses, W siblings and T templates, each held to its gate (`gates.js`).
2. **LGG** (`lgg.js`, `hole-kinds.js`): each group's members are canonicalized again from their files (`unit-trees.js`) and anti-unified in one walk. A difference becomes a hole of one kind: `literal`, `key`, `transform` (one side wraps the other in a call, such as `parseInt(x, 10)`), `ref`, `expr`, `optional` or `stmt`. Equal tuples share one hole. An outer binding with the same name everywhere is a capture; one whose name differs is a `ref` hole. Binder numbers are paired by binding, so one differing region never shifts the rest.
3. **Reject codes** (`rejects.js`): every code is evaluated and stored with the group.

   | Code | Rejects when |
   | :--- | :--- |
   | R1 | more than 4 holes (W: up to 8 literal, key, ref or transform columns; N3: 1) |
   | R2 | hole nodes over member mass above 0.30 (0.35 for templates) |
   | R3 | a hole reads a binder the unit introduces (a catch param, loop var or local); function params are allowed |
   | R4 | a hole holds a return, break, continue, yield or throw of the unit's own function |
   | R5 | a non-transform hole holds an import, global, member-call or regex anchor in at least half the members |
   | R6 | the members' facets differ |
   | R7 | the group matches a convention (`conventions.js`: `capsule-controller-return`, `toc-view`) |
   | R8 | more than 3 capture params after bundling (read-only captures beyond 2 become one options object) |

   The reason is R7 when it fails, else the first failing code.
4. **Refinement** (`refine.js`): when the failing code belongs to some members, they are evicted with a reason and the LGG is computed again (up to 3 rounds). For R3, R4 and R5 these are the members on the failing side of a hole. For R1 and R2, each member outside the largest fp2 class is judged against one reference member; its reason is that pair's R4, R3 or R5 when present, else the pair's first code. The kept members must still pass their gate (W: its floor), else the group is rejected `refine.<rule>`.
5. **Drift** (`drift.js`, `root-shapes.js`): for an accepted group with E >= 30, a unit or window that carries only the group's shared anchors, at least 2/3 of them, weighs at least half the group's mass, and has the same root shape, is drift. A root shape reads statements through their initializer, test or expression and looks through `!`. A logical chain also accepts each operand's shape.
6. **Ranking** (`rank.js`): `score = (instances - 1) * mass * (1 - holeRatio) * levelWeight * (spec ? 0.5 : 1)`. The level weights are fp1 1.0, fp2 and N2 0.9, W 0.8, N3, fp3 and T 0.6. A group inside a higher-scored group is folded into it (`foldedInto`). A group whose every instance contains a lower-scored group's instance depends on it (`dependsOn`). Ranks count only unfolded candidates.
7. **Suppressions**: a group whose suppression key (path, kind, facet and the members' file#fp2 sequences, so line drift does not lose it) matches a `patterns reject` gets status `suppressed`. It is never surfaced and is counted in the summary.

W's merge of same-block buckets uses the same LGG (`unify-step.js`). A pair is parsed only when its fp3 is equal or its anchors (literals and keys aside) differ in 1 or 2 places. A merge is refused by every code except R5, which is judged on the merged group.

## What is stored

`group-store.js` replaces these tables in one transaction per run:

| Table | Holds |
| :--- | :--- |
| `pattern_groups` | every accepted, suppressed and rejected group: path, kind, facet, counts, mass, holes, hole ratio, score, status, reason, `lgg_json` (LGG, verdict, evictions, drift), `depends_on`, `source_id`, `suppression_key` |
| `pattern_group_members` | units by role: `member`, `drift`, `evicted` (with the code) |
| `pattern_suppressions` | `patterns reject` decisions by suppression key and path |
| `pattern_unify_cache`, `pattern_shape_cache` | W merge decisions by instance pair, and row shapes by unit, both with content-hash keys |

A later run reuses a stored verdict when its grouping finds the same member set (`source_id` is the content-derived id before refinement). It reuses merge decisions and row shapes when the units' content is unchanged. Every cache entry carries `FORGE_EXTRACTOR_VERSION` and `LGG_STAGE_VERSION`. Bump `LGG_STAGE_VERSION` when the LGG, the codes, refinement, unify or root shapes change meaning.

## Proof and limits

- `cli/forge/forge-groundtruth.spec.js` runs the whole run over the ground-truth sandbox. It shows: harvest-only recall of at least 0.70, no B group and no C group surfaced, A1 and A19 through W, the A21 and A22 holes, A24 at exactly 11 members, typecheck-command.js as A4 drift, the store, warm reuse, and a suppression round trip.
- `cli/forge/lgg.spec.js` pins the hole kinds and every code on real excerpts. Examples: the B8 readers evicted from A7 (workspace.js R3, check-mcp.js and cmd-wrappers-json.js R4), and B6 and B7 matching their conventions.
- The sandbox (`gt-sandbox.js`, `gt-scaffold.js`) wraps excerpts cut from inside a function in a scaffold that binds their free names, so they are statement units as in the real file.
- Template groups get no script LGG: they are judged on facet and convention after the structural-role refinement of `templates.js`.
- N1 fp1 groups are judged without parsing, since an L1-equal LGG holds only capture-name refs. `--explain` shows `lgg: none` for them.
- Known gaps: `cli/build/` is skipped by the audit's file discovery, so `cli/build/detector.js` (A7.4) is never fingerprinted. A warm run on the kit takes about 3 s, against a 1 s budget; the grouping before the LGG stage already takes about 2 s.
