# Forge groups: `chemx patterns --forge`

Tasks #2536 (Forge P3), #2600 (its review fixes), #4431 (folding, run cache), #2603, #2604 and #2532 (the Forge epic). This page says what the Forge grouping run does after the fingerprint ledger is current, what it stores, and what its output means. The design is `docs/superpowers/specs/2026-10-09-chemx-forge-engine.md` (sections 5-8); this page covers what the code does today.

The plain `chemx patterns` is still the legacy detector, which the roadmap reads. Everything here runs behind `--forge` until P5 swaps the surfaces.

## Commands

| Command | Does |
| :--- | :--- |
| `chemx patterns --forge [dir] [--include-tests] [--idioms]` | Refreshes the ledger, groups it, judges and ranks every group, stores the run in `.chemx/index.db`, and prints one line per ranked group (top 20, `--limit=<N>`), then one rejected-summary line by reason code |
| `... --rejected` | Also lists every rejected and suppressed group with its reason and all of its failing codes |
| `... --explain=<id>` | One group: its holes (kind and up to 3 sides each), captures, members, drift and evicted units, codes and score |
| `... --path=<P> --kind=<K> --json` | Filters (`--path=W`, `--kind=fn`), or the whole run as JSON |
| `chemx patterns reject <id> --reason="..." --as=@handle` | Suppresses a stored group, then posts the decision to the team feed and links the post to the suppression. A stored row without a suppression key is refused, and nothing is written or posted |
| `chemx patterns --groups` | The run as JSON, in the shape the ground-truth scorer reads |
| `chemx patterns --score=<labels.json> --forge [--include-tests]` | Refreshes the ledger (as `--forge` does), then scores the run against the ground truth. `--include-tests` syncs and groups the spec facet too, which the spec items A16 and A17 need (#2603) |

A listing line reads `rank. id path kind | sites/files | E mass holes | first site | drift, dependsOn, evicted, folds counts`. `folds N` counts the groups folded into that slot; `--explain=<id>` lists them with their reason, and a folded group's `--explain` names the slot it folded into.

## The run

1. **Grouping** (`forge-groups.js`): N1 exact buckets at fp1, fp2 and fp3, N2 windows, N3 same-name near misses, W siblings and T templates, each held to its gate (`gates.js`). The return rule (`exits.js`, `body-ends.js`) drops an N1 statement or N2 window with an own `return` unless its last statement ends the enclosing function's body or is itself an unconditional `return`. A conditional return that ends a loop or `if` body does not pass.
2. **LGG** (`lgg.js`, `hole-kinds.js`): each group's members are canonicalized again from their files (`unit-trees.js`) and anti-unified in one walk. A member whose file no longer hashes (sha1) to its stored `content_hash` has no tree and is evicted as `stale`, even when the edit kept its offsets. A difference becomes a hole of one kind: `literal`, `key`, `transform` (one side wraps the other in a call, such as `parseInt(x, 10)`), `ref`, `expr`, `optional` or `stmt`. Equal tuples share one hole. An outer binding with the same name everywhere is a capture; one whose name differs is a `ref` hole. Binder numbers are paired by binding, so one differing region never shifts the rest.
3. **Reject codes** (`rejects.js`): every code is evaluated and stored with the group.

   | Code | Rejects when |
   | :--- | :--- |
   | R1 | more than 4 holes (W: up to 8 literal, key, ref or transform columns; N3: 1) |
   | R2 | hole nodes over member mass above 0.30 (0.35 for templates) |
   | R3 | a hole reads a binder the unit introduces (a catch param, loop var, local or the param of a nested callback) and does not declare itself; only a fn unit's own params are allowed |
   | R4 | a hole holds a return, break, continue, yield or throw of the unit's own function |
   | R5 | a non-transform hole holds an import, global, member-call or regex anchor in at least half the members |
   | R6 | the members' facets differ |
   | R7 | the group matches a convention (`conventions.js`: `capsule-controller-return`, `toc-view`) |
   | R8 | more than 3 capture params after bundling (read-only captures beyond 2 become one options object) |

   The reason is R7 when it fails, else the first failing code.
4. **Refinement** (`refine.js`): when the failing code belongs to some members, they are evicted with a reason and the LGG is computed again (up to 3 rounds). For R3, R4 and R5 these are the members on the failing side of a hole. For R1 and R2, each member outside the largest fp2 class is judged against one reference member; its reason is that pair's R4, R3 or R5 when present, else the pair's first code. The kept members must still pass their gate (W: its floor), else the group is rejected `refine.<rule>`.
5. **Drift** (`drift.js`, `root-shapes.js`): for an accepted group with E >= 30, a unit or window that carries only the group's shared anchors, at least 2/3 of them, weighs at least half the group's mass, and has the same root shape, is drift. A root shape reads statements through their initializer, test or expression and looks through `!`. A logical chain also accepts each operand's shape.
6. **Ranking** (`rank.js`, `fold.js`): `score = (instances - 1) * mass * (1 - holeRatio) * levelWeight * (spec ? 0.5 : 1)`. The level weights are fp1 1.0, fp2 and N2 0.9, W 0.8, N3, fp3 and T 0.6. Folding then gives each repeated shape one slot. Walking groups by score, a group joins the family of a higher-scored group when:

   | Reason | Rule |
   | :--- | :--- |
   | `inside` | every instance lies inside an instance of that family |
   | `overlap` | at least half of its instances cross that family's instances (they overlap and neither contains the other) |
   | `block` | W only: at least half of its instances overlap, in any way, that family's W instances (sibling windows of one block, such as A1's flags) |
   | `wrapper` | every instance strictly contains an instance of that family that is lighter by less than the G1 mass floor (8), such as `const reason = <expr>` around the expression group. A fn group never folds this way |
   | `variant` | it has one fp3 skeleton on every instance, equal to that group's, with the same kind and facet and a shared-anchor Jaccard of at least 0.5 (fp2 variants of one statement) |
   | `fragment` | second pass, any score: a family strictly contains all of its instances but at most 1 (2 for W), the most its residual sites could be without forming a group of their own. Folds never chain: the host must itself be a slot, and a family that took a fragment or holds a member of its own is never folded as a fragment, so a group is never moved under a slot that does not hold it |

   Folding never changes a group's members, LGG or verdict; folded groups are stored, scored by the ground-truth scorer and listed under their slot (`foldedInto`, `foldReason`, `foldedVia` when the group relates to a member of the slot's family rather than the slot root itself, and `folded` on the slot; `--explain` prints `folded into <slot> via <member> (<reason>)`). A group whose every instance contains an instance of a lower-scored group of another family depends on it (`dependsOn`). Ranks count only slots.
7. **Suppressions**: a group whose suppression key (path, kind, facet and the members' file#fp2 sequences, so line drift does not lose it) matches a `patterns reject` gets status `suppressed`. It is never surfaced and is counted in the summary. T partitions that refinement rejected are stored with their suppression key too.

W's merge of same-block buckets uses the same LGG (`unify-step.js`). A pair is parsed only when its fp3 is equal or its anchors (literals and keys aside) differ in 1 or 2 places. A merge is refused by every code except R5, which is judged on the merged group.

## What is stored

`group-store.js` replaces these tables in one transaction per run:

| Table | Holds |
| :--- | :--- |
| `pattern_groups` | every accepted, suppressed and rejected group: path, kind, facet, counts, mass, holes, hole ratio, score, status, reason, `lgg_json` (LGG, verdict, evictions, drift), `depends_on`, `source_id`, `suppression_key` |
| `pattern_group_members` | units by role: `member`, `drift`, `evicted` (with the code) |
| `pattern_suppressions` | `patterns reject` decisions by suppression key and path |
| `pattern_unify_cache`, `pattern_shape_cache` | W merge decisions by instance pair, and row shapes by unit, both with content-hash keys |
| `pattern_run_cache` | the last whole-run result per scope (`--include-tests`, `--idioms`) under its run key, plus which run `pattern_groups` holds (`run-cache.js`) |
| `pattern_body_end_cache` | each read file's function-body last statements, keyed by the engine hash and the file's content sha1 (`body-end-cache.js`) |

A run whose inputs are all unchanged is read back whole from `pattern_run_cache`. Its run key covers every in-scope `pattern_files` row (path, content hash, facet, extractor version; spec-facet files only with `--include-tests`), the engine hash (the source of every module the grouping imports from `forge-groups.js` inside `cli/forge/` and `cli/sfc/`, plus `cli/rules.js` and `cli/babel-lazy.js`), the scope flags, `CHEMX_FORGE_INLINE` and the suppressions. When any in-scope file's mtime or size differs from its ledger stamp, no key is made and the run is computed and not cached. A hit rewrites `pattern_groups` only when another scope's run replaced them. Callers that pass `unify`, `judge: false`, `cache` or `runCache: false` always compute.

The default scope reads no spec-facet rows, even when an earlier `--include-tests` sync left them in the ledger; the filter runs in SQL (#2604). `patterns --sync` reports `scopeRows` (the rows grouping of that scope reads) and `specRows` next to `ledgerRows` (every row stored).

A later run reuses a stored verdict when its grouping finds the same member set (`source_id` is the content-derived id before refinement). It reuses merge decisions and row shapes when the units' content is unchanged. Every cache entry carries `FORGE_EXTRACTOR_VERSION` and `LGG_STAGE_VERSION`. Bump `LGG_STAGE_VERSION` when the LGG, the codes, refinement, unify or root shapes change meaning.

## Proof and limits

- Alias inlining (folding a single-use `const` into its one use before hashing) is off by default. Set `CHEMX_FORGE_INLINE=1` in the environment of the process to opt in; the mode is part of the extractor version, so switching it re-fingerprints the ledger. On the real kit in one run per mode, inlining off gave 1125 groups against 964 with it on, and 16 against 17 of 26 A items credited; more of the top 20 were fragments of one flag shape with it off (6 against 3). The engine spec (section 2, "Inlining: measured trade-off") has the method and the caveats.

- `cli/forge/forge-groundtruth.spec.js` runs the whole run over the ground-truth sandbox. It shows: harvest-only recall of at least 0.70, no B group and no C group surfaced, A1 and A19 through W, the A21 and A22 holes, A24 at exactly 11 members, A7 as one 4-member group that no B8 reader reaches, an A4 group of at least 7 members with typecheck-command.js as drift, the store, warm reuse, a suppression round trip, and `patterns reject` refusing a row without a key. The P3 targets for A4 and A7 were amended in #2600 (phases doc, P3 acceptance).
- `cli/forge/forge-soundness.spec.js` checks three soundness rules on real kit code: a hole that reads a callback param is R3 (cli/audit/autofix.js:85 and :88), a changed member file is stale, and a conditional return that ends a loop body strands its span (cli/edit-locks.js `findForeignLease`).
- `cli/forge/lgg.spec.js` pins the hole kinds and every code on real excerpts. Examples: the B8 readers evicted from A7 (workspace.js R3, check-mcp.js and cmd-wrappers-json.js R4), and B6 and B7 matching their conventions.
- The sandbox (`gt-sandbox.js`, `gt-scaffold.js`) wraps excerpts cut from inside a function in a scaffold that binds their free names, so they are statement units as in the real file.
- Template groups get no script LGG: they are judged on facet and convention after the structural-role refinement of `templates.js`.
- N1 fp1 groups are judged without parsing, since an L1-equal LGG holds only capture-name refs. `--explain` shows `lgg: none` for them.
- `cli/forge/fold.spec.js` pins each fold rule and its negatives on hand-built groups; `cli/forge/run-cache.spec.js` pins hit, off on an unsynced edit, a new key after a sync or a suppression, the restore of `pattern_groups`, and the body-end store; `cli/forge/ledger-scope.spec.js` pins #2604 and `cli/patterns/gt-score-cli.spec.js` pins #2603.
- Measured on the real kit on 2026-10-09 (one session, other agents running, load average 7 to 14, so these are noisy):
  - Top 20 after folding, hand-judged by @forge-refine: 19 distinct shapes. This is one judge on one run, not a precision claim. The reporter-header expression (`lines.push` of the rule line) and the header window remain two slots, because the expression has 3 closing-rule sites outside the windows. Before folding, @forge-measure counted 12 distinct shapes in the top 20 (feed #7332).
  - `chemx patterns --forge` with nothing changed (a run-cache hit): 0.68 to 0.98 s wall over 5 runs at load average about 7. Most of it is process start and module loading: importing the patterns CLI evaluates `@babel/types` and `@babel/traverse` through `search-schema.js` (#4482).
  - After any edit or grouping-code change the run is computed again: 4.3 to 7.3 s with the verdict, unify, shape and body-end caches warm, and 6.35 s for one CLI run. Incremental regrouping is #4485.
  - Ground-truth A recall, harvest-only: 16/26 (62%) in the default scope and 17/26 (65%) with `--include-tests`, below the 0.70 target. The open items are listed in #4484. A6's labels are stale (#4483) and A12 was lost when alias inlining went off by default (#2595).
- Known gaps: `cli/build/` is skipped by the audit's file discovery, so `cli/build/detector.js` (A7.4) is never fingerprinted.
