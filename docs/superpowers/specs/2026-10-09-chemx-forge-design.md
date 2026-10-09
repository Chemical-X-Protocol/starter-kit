# chemx Forge: overview

Part of the Forge design (approved 2026-10-09: P0-P3 now, P4-P8 after a measured precision/recall checkpoint, P9 deletions ask first). Parts: [overview](2026-10-09-chemx-forge-design.md), [engine](2026-10-09-chemx-forge-engine.md), [phases](2026-10-09-chemx-forge-phases.md). Evidence: [ground truth](../reviews/2026-10-09-forge-groundtruth.md), [current machinery](../reviews/2026-10-09-forge-machinery.md), [prior art](../reviews/2026-10-09-forge-priorart.md).

Chosen by a 3-design, 2-judge panel (ast-generalize won 7.85 and 7.88; grafts from library-first and index-dispatch).

## Summary

This is the judges' winner, ast-generalize, with every blocker fixed and the best parts of library-first and index-dispatch grafted on. It is also simpler: N4 MinHash and the contiguous N5 tandem lane are gone.
- **Detect.** Fingerprint visitors run inside the Babel traverse the audit already does (ast-passes.js:66), so no file is parsed twice. They also run from patcher.syncIndex, writeFile and heal, so the ledger stays current between audits.
- **Canonicalize, then hash.** Each unit (function body, statement, gated expression, Vue template subtree) is canonicalized first. That step undoes the surface forms chemx's own rules force: single-use boolean aliases, negations, `!==`. Then each unit gets three Merkle hashes. L1 renames locals, L2 turns literals and keys into holes, L3 is the skeleton.
- **Grouping.** Groups form only on exact hash collisions inside one facet: language, runtime, spec or not, package root. There are five paths:
  - N1: exact buckets at L1, L2 and L3. The L3 bucket has a high mass gate.
  - N2: cross-file statement windows.
  - N3: same-name near-misses.
  - W: within-block siblings, which may be non-contiguous.
  - T: templates, with role refinement.
  Every group then goes through n-ary anti-unification (LGG) under hole limits and eight reject codes. Rejections are stored with their reason.
- **Library.** It holds verified pieces, rule exemplars, conflict resolutions and conventions. Every entry is real code that passes all rules and a sandbox typecheck (spec-enforced). Project pieces are pointers to live exports, and their fingerprint aliases feed a PATTERN_REINVENTED rule.
- **Blueprint.** A blueprint is canonical JSON computed from the LGG: piece, module, signature, call-site splices, typed holes with deterministic defaults, behaviorDeltas, dependsOn and needs. The same code gives the same bytes.
- **Heal.** Heal applies a blueprint as span splices through applyEdits under all-or-nothing leases. Verification is parse, an all-rules audit delta, typecheck (or the checkJs delta in cli/), covering specs, and a post-condition that the duplication is gone. Any failure rolls back byte for byte. Heal never falls back to free-form code.
- **Model work and learning.** Only open name, wording, type or decision holes reach a model. They are child tasks routed by needs tier through team dispatch. Verified heals become project pieces.

## Data model

LOCATION
- All tables live in .chemx/index.db.
- The DDL goes in a new cli/patterns/pattern-schema-ddl.js. search-schema-ddl.js only calls it, so that file stays under 500 lines.
- Tables are created IF NOT EXISTS and evolve through migrateColumns. index_meta records `pattern_extractor_version` and `lib_schema_version`.

TABLES

| Table | Columns |
|---|---|
| pattern_files | path TEXT PK, content_hash, lang, facet_key, extractor_version INT, unit_count INT, updated_at |
| pattern_units | id INTEGER PK, file_path → pattern_files ON DELETE CASCADE, kind CHECK(fn,stmt,expr,tmpl), block_id, ordinal, start, end, start_line, end_line, decl_name, is_export, mass, anchor_weight, anchors TEXT (sorted JSON), fp1, fp2, fp3, facet_key, is_spec |
| pattern_groups | id TEXT PK, path (N1-fp1/N1-fp2/N1-fp3/N2/N3/W/T/LIB), kind, facet_key, member_count, file_count, mass, hole_count, hole_ratio, score, status, reject_reason, lgg_json, depends_on, extractor_version |
| pattern_group_members | group_id, unit_id, role CHECK(home,member,drift,evicted), reason; PK(group_id, unit_id) |
| pattern_suppressions | key_hash, path, reason, by_agent, decision_post_id; PK(key_hash, path) |
| blueprints | id TEXT PK, group_id, kind, needs, auto_applicable, json, status, task_id, piece_ref, updated_seq |
| blueprint_fills | blueprint_id, hole_id, value, filled_by (default/human:@h/model:<id>), model, valid, reason, attempts; PK(blueprint_id, hole_id) |
| heal_runs | id INTEGER PK, blueprint_id, task_id, agent_id, model, effort, started_at, finished_at, outcome (verified/rolled_back/stale/refused), stage, introduced_json, typecheck_mode, specs_run, specs_failed, files_touched, diff_receipt, backups, prompt_tokens, completion_tokens |
| lib_pieces | id TEXT PK, origin (kit/curated/project), role, version, facet_key, module_path, export_name, fp1, fp2, fp3, canonical_for, verified_ruleset, status (verified/quarantined/orphaned/retired), verified_at |
| lib_piece_aliases | piece_id, fp, level, source, origin_ref |
| rule_conflicts | rule_a, rule_b, construct_fp, resolution_id, evidence, friction_task_id, count; PK(rule_a, rule_b, construct_fp) |

Notes on the tables:
- pattern_units indexes: (fp1, facet_key), (fp2, facet_key), (fp3, facet_key), (file_path), (block_id, ordinal), (decl_name, facet_key).
- pattern_groups.id is sha of the sorted member keys (content_hash:start:end).
- pattern_groups.status is one of candidate, rejected, idiom, observation, blueprinted, healed or suppressed.
- blueprints.status is one of planned, tasked, applied, verified, rejected or stale. updated_seq is a counter, not a clock.
- heal_runs telemetry joins to agent_tasks token columns through ingestTaskTelemetry.
- lib_piece_aliases is indexed on (fp, level).
- No new team tables are added. agent_tasks is reused as-is:
  - origin_type = 'blueprint'
  - rule_id = PATTERN_EXTRACT, PATTERN_REINVENTED or PATTERN_DRIFT
  - needs = blueprint.needs
  - target_path = piece.module
  - violation_snapshot = {blueprintId, groupId}
  - Each open hole is a child task with parent_id = the blueprint task. Defaulted holes create no task, so the task table does not flood.

INCREMENTAL PATH
1. **During audit.** auditFileEntry computes sha1(content) and looks up pattern_files. If content_hash and extractor_version match, it sets options.fingerprint=false, so there is no hashing and no rows are written. A changed file, in one withIndexTransaction:
   - collects its old fps;
   - deletes its units (the delete cascades) and inserts the new ones;
   - adds the old and new fps to an in-memory dirty set.
2. **Between audits.** patcher.syncIndex, writeFile and heal call fingerprintFile(absPath) after their micro-sync, so agent edits update the ledger without a full audit.
3. **Standalone `chemx patterns`** never runs rules or runAudit. It uses an mtime and size prefilter, then a hash check, and parses only the changed files with a fingerprint-only traverse (the same PARSE_OPTIONS and SFC parse).
4. **Group refresh.** Only dirty fp buckets are regrouped, plus N2 and W windows in dirty blocks and N3 decl_name buckets of dirty units. LGG is cached in lgg_json under the content-derived group id, so unrelated edits never invalidate it. Member files are re-parsed through a per-run AST cache.
5. **Blueprint invalidation.** A blueprint is marked stale only when a member's body fp changed. Line drift alone does not make it stale.
6. **Determinism.** Every SELECT is ORDER BY file_path, start. Sorts are by code point, with no localeCompare. Ids contain no time-dependent values.

BUDGETS (enforced by perf specs, not just stated)
- Cold audit: no more than +15% over the measured baseline of about 30s.
- Warm audit: no more than +3%.
- Cold `chemx patterns`: 8s or less for about 630 files. Warm, with 5 or fewer changed files: 1s or less.
- Group refresh for under 200 dirty keys: 100ms or less.
- pattern_units for the kit: 40k rows or fewer. expr rows per file: 200 or fewer.
- LGG: at most 50 member pairs per bucket.

## Surfaces

CLI
- `chemx patterns [path] [--kind=fn|stmt|expr|tmpl] [--path=N1|N2|N3|W|T|LIB] [--lang] [--include-specs] [--idioms] [--rejected] [--explain=<group>] [--limit=20] [--json] [--score=<labels.json>] [--no-library]`
  - Default output is one line per group, for example: `extract-function readJsonOr -> cli/fs-json.js | 5 sites/5 files | N1:L2 E32 | needs:light auto | chemx blueprint pg_…`. It ends with one rejected-summary line by R-code.
  - `--explain` prints the LGG, the holes, the members by role and the gate trace.
  - `--score` prints precision and recall per path against the content-anchored labels, attributing each found item to its mechanism. `--no-library` measures harvest-only recall.
- `chemx patterns reject <group> --reason="…" --as=@h` writes pattern_suppressions plus a decision post.
- `chemx patterns stats` shows per-path telemetry.
- `chemx blueprint <group|bp> [--json] [--out=<file>] [--task --parent=<epic> --as=@h]` builds or shows a blueprint. `--task` creates the blueprint task plus one child task per open hole, idempotently by bp id.
- `chemx blueprint holes <bp>` prints the compact hole prompts. `chemx blueprint fill <bp> id=value --as=@h` validates fills and closes the hole tasks.
- `chemx blueprint --top=N --task` turns the top N blueprints into tasks.
- `chemx heal <bp> [--dry-run] [--fill …] [--collapse-wrappers] --as=@h` and `chemx heal --undo <run>`. A passing heal prints one line under 80 tokens.
- `chemx library list|show <id>|verify [--write]|sync|sync-fixtures|add <file#symbol>|aliases <id>`
- `chemx typecheck --sandbox <dir> [--checkjs]` is a new, chemx-wrapped sandbox typecheck. It replaces the raw tsc call that the kit guard blocks.

MCP
- `patterns` becomes index-backed: no runAudit per call (tools-patterns.js:12). It keeps the {scannedDir, totalCandidates, compact, candidates[]} envelope and the old aliases chemx_query_patterns and query_patterns.
  - Candidates keep id, type, label, suggestedCapsule (= piece.module), recommendation, fileCount, totalHits, impactScore (= score), files and sampleOccurrences.
  - New fields: kind, path, level, facet, needs and blueprintId.
  - The legacy `type` enum maps STATE_UNION→type-literal-set, UI_STRUCTURE→tmpl, PREDICATE_LOGIC→empty plus a deprecation note, HOOK_SIGNATURE→fn.
- New actions:
  - `blueprint` (show, create, holes, fill): read-only except create and fill.
  - `heal` (apply, dry-run): mutating, root required.
  - `library` (list, show, verify, add): add is mutating.
- All new actions go into manifests-analysis.js, cli/mcp/types.d.ts and the README action table (docs-drift.spec).
- Stale-server guard: results carry extractor_version, and heal refuses when the server's extractor_version or piece versions differ from index_meta. The message is `reconnect chemical-x via /mcp`.

AUDIT OUTPUT
- report.patterns keeps its compact shape through the adapter, sits behind `--full` per truth-and-cost spec :342-346, and is sourced from pattern_groups.
- The human audit prints one line: `Blueprints: 14 (9 light/6 auto, 4 standard, 1 deep) - chemx patterns`.
- New RULE_REGISTRY rules, each with a good/bad fixture pair and with needs and pillar mappings:
  - PATTERN_REINVENTED (LOW, light): a unit fp hits a piece alias outside the piece module.
  - PATTERN_DRIFT (LOW, standard): a drift member of an accepted group.
- Both flow through the violations table, so the gate, ratchet and dispatch see them.
- audit_snapshots gains dup_mass = Σ mass*(instances-1) over candidate groups, for the trend.

ROADMAP AND PROMPTS
- Phase 1 has one item per blueprint:
  - title `<kind> <name>: <n> sites in <f> files`
  - target = piece.module
  - needs
  - Command lines `chemx blueprint <id>` and `chemx heal <id> --dry-run`
- With no blueprints, Phase 1 is omitted instead of showing the generic survey.
- Static phases emit a Command line only when the target resolves to an existing path or an indexed symbol. This removes `chemx q "Component"` and `chemx q "Copy,"`.
- The AI AGENT DISCOVERY block (roadmap.js:202-206) lists patterns, blueprint and heal --dry-run. EXECUTION DISCIPLINE adds: "apply extractions only through chemx heal; never hand-copy a piece".
- prompts.js "Pre-Split Pattern Discovery" (:117, :318, :367) is reworded to: "run `chemx patterns <file>`; if a blueprint covers code you are splitting, heal it first".
- buildAgentCommandsSection adds patterns and blueprint.
- prompt-rule-lines.js adds `Canonical: chemx library show <id>` for rules that have a canonicalFor entry.

DISPATCH
- `chemx team dispatch --origin=blueprint` filters blueprint work.
- selectDispatchTasks already skips parents that have open children, so hole tasks dispatch first.
- buildBlueprintPrompt, a sibling of buildAgentPrompt in team-dispatch-render.js, batches up to 20 light hole tasks into one haiku/low agent. The prompt is about 6 lines plus about 60 tokens per hole: claim, `chemx blueprint holes`, `chemx blueprint fill`, done.
- A heal parent with no open holes is never sent to a model:
  - with `--auto-heal`, dispatch runs `chemx heal` in-process as the dispatcher handle;
  - otherwise one light step runs `chemx heal <bp> --as=@h && chemx team task done …`.
- Workflow phase order is Holes, then Heal, then a single `chemx verify` after the wave.
- Routing is routeModel(needs, modelRouting) (cli/team/team-dispatch.js:129): light haiku/low, standard sonnet/medium, deep opus/high. model is never left unset.
- A blueprint that rolls back twice gets needs=deep and a design hole.
- Telemetry: per-path precision = verified/(verified+rolled_back+human-rejected). When it falls below 0.6 over the last 20 outcomes, a `Friction: path <x> precision <p>` task is filed. Thresholds change only through a versioned extractor bump plus a decision post, never automatically.

## Migration

NEW MODULES (each under 300 lines; ESM JS like the rest of cli/)

cli/patterns/:
- canonicalize.js, hash.js, anchors.js
- units.js: createFingerprintVisitors
- template-units.js, facets.js, store.js, pattern-schema-ddl.js
- group.js: N1, N2, N3
- siblings.js: W
- lgg.js, gates.js: G and R codes plus drift
- refine.js, rank.js, naming.js, placement.js
- blueprint.js: canonical JSON, needs
- heal-ops.js, heal-apply.js, heal-verify.js
- fingerprint-file.js: used by patcher, writer and heal
- thresholds.js: defaults, overridable in .chemx/config.json `patterns.*`

cli/library/:
- registry.js, verify.js, fixtures-sync.js, fixture-gen.js, harvest.js, entry-schema.js (runtime guard, no zod)

cli/commands/:
- cmd-patterns.js, cmd-blueprint.js, cmd-heal.js, cmd-library.js, registered in commands-schema-* and help.js

cli/mcp/:
- tools-blueprint.js, tools-heal.js, tools-library.js

Other new pieces:
- `library/` at the kit root, listed in package.json files.
- typecheck-command.js gains the `--sandbox` plan.

pattern-detector.js
- Removed:
  - PREDICATE_LOGIC (:402-418) and HOOK_SIGNATURE (:419-436);
  - the hard-coded suggestedCapsule and recommendation map (:49-66), including usePredicateFilter.ts and useSharedController.ts;
  - categorizeUiStructure (:90-175);
  - the regex template scanner (:181-332) and the JSX tag-shape path (:338-400).
- STATE_UNION is kept, re-expressed as a sorted-literal-set unit (kind 'type') in the store.
- createPatternRegistry and resolveHarmonizationCandidates become a thin adapter over store.js. That keeps report.patterns, the MCP envelope and the `record(type, sig, loc)` call shape pinned by friction-fixes.spec.js:73 until those specs migrate.
- The file shrinks to the adapter. Deleting it is ask-first, in the last phase.

ast-passes.js:66: createFingerprintVisitors replaces createPatternVisitors. It is skipped under options.fast (rules.js:74) and when options.fingerprint=false.

clone-detector.js
- The embedding path never fires: there are no target_type='file' rows (search-index-write.js:54-63), and feature-hash vectors measure vocabulary, not structure.
- detectSemanticClones becomes a query over pattern_groups at L1 and L2, with the same {pairs, isExact} return shape. isExact means L1 with zero holes.
- `--clones` and `--clone-threshold` map to E and (1-holeRatio).
- reporter-clones.js changes only its labels.
- The embeddings table stays for search.

roadmap.js
- Phase 1 (:30-51) is built from blueprints, with no generic fallback.
- The Command line logic (:219-223) is guarded by path or symbol resolution.
- Discovery (:202-206) and EXECUTION DISCIPLINE (:228-233) get the new text.

prompts.js
- Rule 1 text at :117, :318 and :367 is reworded.
- buildAgentCommandsSection (:73-79) gains the new commands.
- All of it passes docs-drift: no cx/cmx, no flat budgets.

Rules
- narrowsMutableRef remedy text on CONTROL_FLOW_INLINE_BOOLEAN (ast-visitors.js:122-140). It is a new remedy line only; detection semantics are unchanged, so it needs no RULESET bump.
- PATTERN_REINVENTED and PATTERN_DRIFT go in RULE_REGISTRY with a RULESET_VERSION bump to 6. rule-revisions.spec gets a new snapshot.

SPECS TO UPDATE
- **rule-fixtures.spec.js:** an all-rules zero-violation assertion for every good fixture, and the NAMING_BARE_BOOLEAN good fixture fixed (it trips AI_SLOP_REDUNDANT_PASSTHROUGH). Also new fixture pairs for the two new rules.
- **pattern-detector.spec.js:**
  - Rewrite recordTemplatePatterns: two files with `v-sheet>(x-btn+x-btn)` are now NOT a candidate, and three attribute-identical subtrees are.
  - Keep the rule-of-three test, retargeted.
  - Drop the extractTemplateTokens and categorizeUiStructure tests. Ask first, because this deletes tests.
- **friction-fixes.spec.js:72-78:** `a && b && c` in a Vue script yields no unit (E < 18), and a script function in a .vue file is fingerprinted at line 15 through the overlay.
- **clone-detector.spec.js:** rewritten over real store rows, which removes the spec that masked the 0-row bug.
- **mcp/server.spec.js** (:61-82, :289-314): unchanged shape. Add blueprint, heal dry-run and library tests.
- **docs-drift.spec.js:** README rows for the new actions.
- **rules-needs.spec.js and rule-pillars.spec.js:** mappings for the new rules.

NEW SPECS
- canonicalize.spec, including property tests.
- units.spec, store/incremental.spec, group.spec, siblings.spec, lgg.spec, gates.spec (one case per R-code), refine.spec.
- determinism.spec: shuffled file order and repeated runs give identical group ids and blueprint bytes.
- groundtruth.spec: verbatim excerpts in cli/patterns/fixtures/gt/ with provenance comments, plus labels.json anchored on excerpt hashes, not line numbers.
- library.spec, heal-apply.spec (tmpdir project), dispatch-blueprint-render.spec, perf.spec (budgets).

DOCS
- docs/ architecture page "Forge: detect, library, blueprint, heal, learn", reference pages for the four commands, and a docs/INDEX.md entry. Changelog in the kit's docs/CHANGELOG.md.
- Root CLAUDE.md and AGENTS.md command-map rows for patterns, blueprint and heal.
- A note that "blueprint" (chemx.blueprint/1, stored in index.db) is not the generator's blueprints/ directory.

## Risks

1. **Canonicalization soundness is the single point of correctness.** Alias inlining requires a single use in the next statement, no intervening write, and either a first-evaluated use position or a pure initializer. De Morgan keeps operand order. `!==` to `!(===)` is definitional. Mitigation: property tests plus the determinism spec in P2, before any blueprint is emitted.
2. **Thresholds are tuned on one repo.** The E gates, hole limits and rule of 3 are starting points. Mitigation:
   - they live in thresholds.js and .chemx/config.json `patterns.*`;
   - changes ship only as a versioned extractor bump with a decision post;
   - per-path telemetry files Friction tasks below 0.6 precision and never auto-tunes.
3. **Small L1 expression idioms dominate unlabeled output.** Examples: path.join plus existsSync, JSON.stringify combinations. Mitigation:
   - a weight of 0 for ubiquitous anchors and at least 2 non-ubiquitous anchors per expr row;
   - the idiom class is hidden by default;
   - maximality folding;
   - hand-judged top-20 precision is measured in P5 before downstream phases rely on it.
4. **The L3 (fp3) bucket is loose.** It exists for A21. Mitigation: the G3 mass gate and mandatory LGG under R1-R5. Groups that fail become rejected rows, visible with --rejected.
5. **Behaviour changes hidden as refactors.** Cases: A1 split truncation, A3 empty stdout, A4 isAbsolute drift, A9 tint, A10 OSC, A11 arrays. Mitigation: behaviorDelta and drift always become standard decision holes, are never auto-healed, and are listed in the task and the dry-run header.
6. **Span edits without a printer.** Risk areas: Vue loc offsets, import-merge edge cases, indentation. Mitigation: snapshot fixtures, the SFC compile check, a scoped lint --fix when configured, re-parse, and the all-rules gate with byte-identical rollback.
7. **The cli/ typecheck is weak.** cli/ is plain JS with no checkJs. Mitigation: pieces are checked strictly in a sandbox with JSDoc, sites by diagnostic delta, and the verdict names the mode. Semantic safety rests on covering specs; a site with no spec escalates to standard.
8. **Ruleset churn.** Pieces are re-verified cheaply and quarantined rather than hard-failed. Blueprint ids exclude the ruleset, so unrelated rule bumps do not invalidate open blueprints.
9. **Stale MCP servers run old fingerprint code.** Mitigation: extractor_version in pattern_files and index_meta, plus a heal-time version check that tells the user to reconnect.
10. **Lock contention on multi-file heals.** Mitigation:
    - all-or-nothing leases;
    - file-disjoint dispatch batches (the blueprint's lock list goes into the task description);
    - light heals touch 6 files or fewer;
    - blueprints with more than 15 files are deep and split per directory.
11. **Recall gaps by design.** Type-4 logic (A26), intent-level reuse with different structure (A2 to readFlagValue), constant tables (A9), and sub-gate expressions (A13). Mitigation: library aliases learned after one mapped instance, and curated pieces in chemx-library/.
12. **Kit-seed overfitting.** The seed was chosen with this groundtruth in view. Mitigation:
    - the seed is generic idioms only, with real negatives;
    - project-specific shapes must come from harvest;
    - the eval reports harvest-only recall separately (`--no-library`).
13. **Name collision with the generator's blueprints/ directory.** Mitigation: the chemx.blueprint/1 schema tag, storage in index.db, and a docs note.
14. **Ask-first rule.** Deleting legacy code and tests waits for explicit user confirmation (P9), and the adapter keeps the old shapes alive until then.

## Predicted ground-truth score

METHOD
- An A item scores 1 when it is found with a usable blueprint (at least 2 correct sites and no foreign sites), and 0.5 when it is partial.
- Predictions trace the rules above through code that the three designs read. I re-read team-flags.js:36-110, useSelfCleaningTimeout.ts and lifecycle-predicates.js:15-80 for this synthesis.

FOUND (17)
- A1: W, non-contiguous siblings with alias inlining and an fp3 merge. This is a fix over ast-generalize's N5.
- A3: an N2 window with a superset behaviorDelta.
- A4: L1 expr, about 7 or more sites plus 2 drift.
- A5: N2, dependsOn A4.
- A6: N3.
- A7: L2 try, 5 sites. B8 members are rejected.
- A10: N3, with a decision hole.
- A11: N3.
- A12: L1, except the inline trim variant.
- A14: N2 tail window.
- A15: L1, 31 sites.
- A16: L1 window in specs.
- A19: W.
- A21: N1 fp3 plus LGG. This is a fix: the grouping path is now defined.
- A22: L2.
- A24: T plus structural-role refinement, 11 instances.
- A25: W template siblings.

PARTIAL (7, at 0.5)
- A2: only the identical flagValue pair. The readFlagValue mapping needs a learned alias.
- A8: an N2 window dependsOn A7, about 3 of 4 sites.
- A9: theme constants only through reuse after a curated alias; the inline glyphs are missed.
- A13: borderline against the mass >= 8 gate.
- A17: the mkdtemp expression only.
- A18: only after textItem is registered as a project piece.
- A20: the common fetch window only; the isLoading variants exceed the gap limit now that MinHash is dropped.

MISSED (2)
- A23 is not an independent item, because it is folded into A21. It counts as found through A21 in the scorer if the labels allow nesting; otherwise it is a miss.
- A26 is Type-4-ish.

PREDICTED RECALL
- Item recall is (17 + 3.5)/26 ≈ 0.79, with a band of 0.70 to 0.85 depending on thresholds.
- Harvest-only (`--no-library`) is about 0.75, because the kit seed only accelerates A3, A4, A5, A7 and A22, which harvest also finds.
- Phase targets are set below the estimate: at least 0.70 harvest-only, and at least 0.75 with the library.

FALSE ITEMS: 11 of 11 rejected, each by a structural cause, not by tuning
- B1, B11: no L1 or L2 collision, anchorWeight 0 or under the gate. PREDICATE_LOGIC is deleted.
- B2: structural child roles give partitions of fewer than 3.
- B3: excluded path plus three facets.
- B4: runtime facet.
- B5: different anchors, with R4/R1 under L3.
- B6, B7: R7 conventions, plus G4 or anchorWeight 0.
- B8: R3 and R4. This is pinned by negatives in the read-json-or entry.
- B9: different node types.
- B10: different subtree.
Precision on the labeled B set is therefore 1.0.

BORDERLINE
- C1 (R1/R2), C2 (in-file count 2 < 3) and C3 (R4) are not surfaced.
- C4 is an A12 behaviorDelta member, C5 an A20 weak member, C6 the identical triple only, and C7 sits inside A15.
- This matches the groundtruth leanings in 7 of 7.

UNLABELED PRECISION
- Top-20 precision on the live kit is predicted at 0.85 to 0.9 once idioms are suppressed.
- The main risk is two-anchor L1 expression idioms and L3 bucket noise. P5 measures this by hand before downstream phases depend on it.
- Baseline today: 0 A items found, and 8 of 12 candidates are B1-class clause buckets.
