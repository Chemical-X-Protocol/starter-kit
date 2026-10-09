# chemx Forge: phases

Part of the Forge design (approved 2026-10-09: P0-P3 now, P4-P8 after a measured precision/recall checkpoint, P9 deletions ask first). Parts: [overview](2026-10-09-chemx-forge-design.md), [engine](2026-10-09-chemx-forge-engine.md), [phases](2026-10-09-chemx-forge-phases.md). Evidence: [ground truth](../reviews/2026-10-09-forge-groundtruth.md), [current machinery](../reviews/2026-10-09-forge-machinery.md), [prior art](../reviews/2026-10-09-forge-priorart.md).

## P0 Rule fixtures as an all-rules fixed point, and a `chemx patterns` alias (needs: light)

**Deliverables**

- An assertion in rule-fixtures.spec.js that every good fixture reports zero violations of ANY rule under atomic-strict.
- Fix the NAMING_BARE_BOOLEAN good fixture, which trips AI_SLOP_REDUNDANT_PASSTHROUGH.
- A `chemx patterns` CLI alias wired to the existing MCP handler until P5.
- Friction tasks filed for the CLAUDE.md command drift.

**Acceptance**

- `chemx test cli/audit/rule-fixtures.spec.js` is green with the all-rules assertion: every non-sibling good fixture is clean, or has a recorded `conflicts` entry with a Friction task id.
- `chemx patterns` no longer prints Unknown command.
- `chemx verify` is green.

## P1 Ground-truth harness, baseline, and sandbox typecheck (needs: standard)

**Deliverables**

- cli/patterns/fixtures/gt/: verbatim excerpts for A1-A26, B1-B11 and C1-C7, with provenance comments.
- labels.json, anchored on excerpt content hashes.
- `chemx patterns --score=<labels>`, wrapping the current detector to record a baseline.
- `chemx typecheck --sandbox <dir> [--checkjs]` in typecheck-command.js, running the local tsc or vue-tsc through findLocalBin with a temp strict tsconfig.

**Acceptance**

- The scorer is deterministic across two runs.
- The baseline is recorded in a task comment: about 0 A recall, and 8 of 12 current candidates are B-class.
- `chemx typecheck --sandbox` passes on a JSDoc'd readJsonOr under checkJs-strict, and fails with TS7006 on an un-JSDoc'd copy. No raw-tsc bypass is needed.

## P2 Fingerprint core, canonicalization and incremental store (needs: deep)

**Deliverables**

- canonicalize.js, hash.js, anchors.js, units.js, template-units.js, facets.js, store.js, pattern-schema-ddl.js and fingerprint-file.js.
- createFingerprintVisitors merged in ast-passes.js.
- options.fingerprint=false for unchanged files.
- fingerprintFile hooked into patcher.syncIndex, writeFile and heal.
- Exclusion globs.
- Property tests and perf.spec.

**Acceptance**

Equivalences (canonicalize.spec):
- the useSwarmTasks.ts:10-11 and useSwarmFeed.ts:11-12 forms hash equal at L2;
- `!a && !b` and `!(a||b)` hash equal;
- the team-flags :41-46 and :48-53 pairs are equal at L2.
Property tests show canonical forms evaluate equal to the originals on generated inputs, and side-effecting initializers are never inlined.

Unit behaviour:
- `a && b && c` in a Vue script yields no unit.
- The check-host.js:16-20 and project-status.js:12-16 excerpts have equal fp2 and different fp1.

Incrementality and cost:
- A second `chemx patterns` with no edits parses 0 files, and touching one file re-fingerprints exactly 1.
- A patch through chemx updates that file's rows without an audit.
- Enforced time guarantee is warm (measured 2026-10-09, decision feed #6773): Forge adds 1.9ms to a 305ms audit (under 3%), and warm sync takes 14ms idle and 132ms with 5 edits (under 1s).
- Cold costs are published as measured, not as targets met: cold sync 651ms against the 305ms target, and uncapped cold audit 857ms against 350ms. Both are improved under #2554.
- The 40k pattern_units budget applies to the default audit scope (measured 32,416 on 2026-10-09). Spec files are a separate facet whose count is published, not capped (total 55,983).

General:
- Every file is under 500 lines.
- `chemx verify` is green.

## P3 Grouping, anti-unification, gates and refinement (needs: deep)

**Deliverables**

- group.js: N1 at fp1, fp2 and fp3 with G1-G3; N2 maximal windows; N3.
- siblings.js: W, non-contiguous within a block, with fp3 merge.
- lgg.js: n-ary LGG with typed, transform and capture holes.
- gates.js: G1-G4, R1-R8 and drift.
- refine.js: structural-role partitioning.
- rank.js: maximality and dependsOn.
- pattern_groups rows with reason codes.
- pattern_suppressions plus `patterns reject`.

**Acceptance**

groundtruth.spec, groups that must be found:
- A1 (W covers at least 10 of the 13 two-form flags across the interleaved :69-73/:100-104/:123-124 gaps)
- A4 (at least 7 members plus typecheck-command and team-dispatch-batches as drift)
- A7 (5 members; workspace and ratchet rejected R3, cmd-wrappers rejected R4)
- A12
- A19 (W)
- A21 (N1 fp3 with url, body and refetch holes)
- A22
- A24 (exactly 11 members)

groundtruth.spec, groups that must not form:
- B1, B11, B9, B4, B3 and B10.
- B2 is rejected with a refine reason; B6 and B7 are suppressed by R7.
- C1, C2 and C3 are not surfaced.

Amended by #2600 (P3 review). The P3 run cannot reach three of these targets, so the run-level spec asserts the following instead:
- A4: a group of at least 7 members that covers at least 5 A4 anchors, with typecheck-command.js:41-43 as drift. team-dispatch-batches.js:38 is not drift at P3, because the P2 inliner folds `isOutsideRoot` into the return at :38-40, so :38 is not a unit of its own. Expression-level drift inside an inlined statement is deferred.
- A7: one 4-member N1 fp2 group (check-host, kit-locate, project-status, project-detector). A7.4 sits under cli/build/, which file discovery skips. No B8 reader reaches any A7 bucket: the try statements of workspace, check-mcp and cmd-wrappers-json have their own fp3, and the B8.1 excerpt of ratchet.js (:37-48) stops before its closing `};`, so it does not parse in the sandbox. The R3 and R4 evictions (workspace R3, check-mcp and cmd-wrappers-json R4) are asserted in lgg.spec on those members. Ratchet R3 is untested until its excerpt parses.
- B6 and B7 form no group even before the LGG stage (grouping and its gates stop them), so they never reach R7 at run level. Their R7 conventions are asserted in lgg.spec.

Other checks:
- With --no-library: item recall of at least 0.70, counting partial as 0.5.
- determinism.spec: identical group ids under shuffled input.
- A warm `chemx patterns` runs in 1s or less.

## P4 Library format, kit seed, resolution piece and verification spec (needs: standard)

**Deliverables**

- `library/` with entry.json, concrete pieces, piece specs and negatives.
- Seed entries:
  - node-js: read-json-or, is-path-inside, relative-if-inside, git-root;
  - vue-ts: visible-poller and the resolution nullable-timer-handle;
  - conventions: capsule-controller-return, toc-view, framework-mirror.
- cli/library/ registry, verify, fixtures-sync and fixture-gen.
- library.spec: parse, all-rules audit, sandbox typecheck, piece spec, fp consistency, negatives, exemplar fixed point, interaction matrix.
- rule_conflicts rows.
- The narrowsMutableRef remedy line on CONTROL_FLOW_INLINE_BOOLEAN.
- Quarantine on ruleset bumps.

**Acceptance**

Conflict resolution:
- library.spec fails if any piece or good exemplar reports any rule, or if a negative matches.
- nullable-timer-handle passes CONTROL_FLOW_INLINE_BOOLEAN, TIMER_DISCIPLINE and vue-tsc strict together.
- Its two negatives fail: the const-alias form reports TIMER_DISCIPLINE, and the inline `!== null` guard reports INLINE_BOOLEAN.
- A fixture for `if (timerId !== null) clearTimeout(timerId)` gets a hazard whose remedy names the piece.

Ruleset handling:
- A bumped RULE_REVISIONS re-verifies entries.
- A deliberately failing entry becomes quarantined and files a Library: task.
- Unrelated open blueprints are not invalidated.

General: `chemx verify` is green.

## P5 Naming, placement, blueprints, CLI/MCP surfaces, roadmap and prompt rewrite (needs: standard)

**Deliverables**

- naming.js and placement.js: facet-to-kind table, host-module preference, package-root check.
- blueprint.js: canonical JSON, needs, dependsOn, behaviorDelta.
- Library match path to reuse blueprints.
- `chemx patterns`, replacing the P0 alias, plus `chemx blueprint` (incl. holes and fill).
- Index-backed MCP `patterns` plus `blueprint`.
- pattern-detector.js reduced to an adapter; clone-detector.js over pattern_groups.
- roadmap.js Phase 1 and its Command lines; prompts.js rule-1 text.
- README, docs and docs/INDEX.

**Acceptance**

Blueprint outputs:
- The A7 blueprint is byte-identical across 3 runs and a shuffled order, names readJsonOr in cli/fs-json.js, and lists the 4 B8 members as rejected.
- A4's host is cli/path-scope.js, with a drift decision hole at standard.

Language awareness (spec):
- No cli/** blueprint has a hook or composable kind, or a .ts, .tsx or .vue module.
- Every Vue template group yields a .vue capsule through the generator.
- A React hook kind is impossible unless the unit calls React hooks.

Roadmap and MCP:
- The roadmap on the kit contains no usePredicateFilter, useSharedController, m-feature-card, m-pill-row or 'N-clause' labels, and no `chemx q "Component"` or `"Copy,"` lines.
- server.spec compact-shape tests and docs-drift are green.

Precision on live output:
- The live-kit top 20 is hand-judged, with a precision of at least 0.85 recorded in a task comment.
- Below that, thresholds are tuned with a decision post before P6.

## P6 Heal engine: span codemods, locks, verify and rollback (needs: deep)

**Deliverables**

- heal-ops.js: replaceRange, insertExport, createModule, addImport (merge forms), dropUnusedImports, hoistComments, tabulate, scaffoldCapsule, opt-in collapseWrapper.
- heal-apply.js over applyEdits, with all-or-nothing leases.
- heal-verify.js:
  - all-rules baseline delta;
  - typecheck modes (scoped, sandbox, delta);
  - covering specs via reverse imports;
  - exemplar fpBad guard;
  - post-condition;
  - resolution-piece verdict.
- heal_runs and blueprint_fills.
- `chemx heal`, `--undo`, MCP `heal`.
- Snapshot fixtures for comments, `import x, { y }`, side-effect imports, Vue self-closing tags and `<script setup>` plus `<script>`.

**Acceptance**

heal-apply.spec, in a tmpdir project seeded with copies of the A7 and A4 member files:
- The dry-run diff matches a snapshot: comments hoisted, `fs` dropped only where its reference count reaches zero.
- A real heal leaves `chemx verify` green.
- An injected rule violation in the piece rolls back to byte-identical files with outcome rolled_back and stage audit.
- A foreign lease on one site refuses before any write.
- A changed member body gives BLUEPRINT_STALE; pure line drift does not.
- A heal whose rendered code reintroduces the inline timer guard returns the verdict `use piece vue-ts/nullable-timer-handle` and never reverts.
- Post-condition: after the heal, the group key count is no greater than the piece's own exports.

## P7 Dispatch integration: hole tasks, auto-heal and telemetry (needs: standard)

**Deliverables**

- `chemx blueprint --task` and `--top=N --task`: a blueprint task plus a child task per open hole.
- `team dispatch --origin=blueprint`.
- buildBlueprintPrompt, batching up to 20 light holes per agent.
- `--auto-heal` for zero-open-hole light parents.
- Holes, Heal, Verify workflow phases.
- Hole tier escalation.
- `chemx patterns stats` and per-path precision Friction filing.
- dispatch-blueprint-render.spec.

**Acceptance**

- A dispatch over 5 blueprint tasks renders at most 1 haiku/low hole agent and 0 agents for auto-applicable heals.
- A light heal task routes to haiku/low and an extract-component task to sonnet/medium (routing spec).
- No launch has model unset.
- Light blueprints use 500 or fewer model tokens per verified heal, measured and joined from agent_tasks telemetry.
- A behaviorDelta blueprint is never auto-healed.

## P8 Learn loop: project pieces, PATTERN_REINVENTED and PATTERN_DRIFT, reuse hints (needs: standard)

**Deliverables**

- Post-heal registration of project pieces with aliases.
- `chemx library add`, `sync`, and the curated chemx-library/ dir.
- PATTERN_REINVENTED and PATTERN_DRIFT rules with fixture pairs, needs and pillar mappings, and a RULESET bump.
- reuseHint on patch and write results, non-blocking.
- Orphan handling.
- `patterns --score` final eval against the live kit.

**Acceptance**

Learn loop:
- After healing A7 in the tmpdir project, adding a verbatim JSON try-reader in a new cli/ file produces PATTERN_REINVENTED and a zero-hole reuse blueprint that auto-heals green.
- A chemx write of that same reader returns a reuseHint naming readJsonOr.
- A suppressed key stays rejected across runs.

Final eval, recorded per mechanism in a task comment:
- Live-kit `patterns --score`: item recall of at least 0.75 with the library, and at least 0.70 harvest-only.
- 11/11 B items rejected.
- Top-20 precision of at least 0.85.

## P9 Cleanup of the legacy detector (ask-first) (needs: light)

**Deliverables**

After the user explicitly confirms:
- Remove the pattern-detector adapter once every consumer has moved.
- Remove the regex-scanner and categorize tests, the hooks/usePredicateFilter.ts suggestion path, and the clone-detector embedding query.
- Move hooks/*.ts into library/react-tsx entries.
- Update the CLAUDE.md and AGENTS.md command-map rows and the kit changelog.

**Acceptance**

- The user's confirmation is recorded as a decision post before any deletion.
- `chemx q -g "usePredicateFilter" -l` and `chemx q -g "useSharedController" -l` return nothing outside library/react-tsx and history.
- `chemx verify` and docs-drift are green.
- Every library.spec exemption has a matching Friction task id.
