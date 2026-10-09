# chemx Forge: engine (detection, library, blueprint, heal)

Part of the Forge design (approved 2026-10-09: P0-P3 now, P4-P8 after a measured precision/recall checkpoint, P9 deletions ask first). Parts: [overview](2026-10-09-chemx-forge-design.md), [engine](2026-10-09-chemx-forge-engine.md), [phases](2026-10-09-chemx-forge-phases.md). Evidence: [ground truth](../reviews/2026-10-09-forge-groundtruth.md), [current machinery](../reviews/2026-10-09-forge-machinery.md), [prior art](../reviews/2026-10-09-forge-priorart.md).

## Detection

PIPELINE: units -> canonicalize -> hash L1/L2/L3 -> store in index.db -> bucket by (fp, facet_key) -> gates -> LGG -> refine/reject -> rank. Clause counts, tag-only shapes and name similarity are never evidence. Names are only a candidate generator on N3 (identical declared names), and they are used to name output.

1. UNITS
They are collected in createFingerprintVisitors, which replaces createPatternVisitors in ast-passes.js:66. Unit kinds:
- **fn:** bodies of FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, ClassMethod and ObjectMethod. Params are stored separately. An expression-bodied arrow becomes `{ return e }`. decl_name comes from the id, the VariableDeclarator or the property key, which fixes the arrow blind spot at pattern-detector.js:421.
- **stmt:** every canonical statement in every block, with block_id and ordinal. A TryStatement is one stmt unit.
- **expr:** a LogicalExpression, ConditionalExpression, CallExpression or NewExpression that is a full initializer, return argument, call argument or ExpressionStatement, never a sub-operand. It is stored only when E >= 18, mass >= 8 and it has at least 2 non-ubiquitous anchors. Hard cap: 200 expr rows per file; hitting it is logged.
- **tmpl:** Vue element subtrees from sfc.template.ast (sfc-parse.js:37-45). These replace the regex scanner at pattern-detector.js:181-332. JSX uses the same normalizer from the Babel JSX AST. Svelte is skipped until it has a template AST.

Exclusions:
- blueprints/**, library/**, cli/**/fixtures/**, *.d.ts, components*.d.ts, dist, node_modules, and files with GENERATED_MARKERS.
- Specs are kept with facet spec=true and never mix with source.

2. CANONICALIZATION (hashing tree only, never emitted)
- Strip parentheses, TS annotations, `as` and the non-null `!`. Types are side info for signatures.
- Flatten &&/|| into n-ary nodes. Operand order is never sorted.
- De Morgan: fold maximal runs of negated operands, so `!a && !b` ≡ `!(a || b)`. Short-circuit order is unchanged.
- `x !== y` becomes `!(x === y)`, and `!=` becomes `!(==)`. These are definitionally equal, including for NaN and objects.
- Single-use const alias inlining, applied to a fixpoint. `const k = e;` is inlined only when all of these hold:
  - it has exactly one reference;
  - that reference is in the immediately next statement;
  - there is no write in between;
  - either the reference is the first-evaluated operand of that statement, or e is inert and nothing that could run code completes before the reference. Inert means it cannot throw and runs no user code: literals, non-global identifiers, undefined/NaN/Infinity, and `!`, `typeof`, `void`, `===`, `&&`, `||`, `??`, `?:` over inert operands. Member reads are not inert, because a getter can run or `null.x` can throw (`const n = u.name; return u && n` must keep n). Arithmetic, `==`, templates and spreads are not inert either, because valueOf, toString and iterators run code (#2586);
  - the reference is not inside a nested function, a class field value, a loop body or test, or a destructuring pattern;
  - e is not the global `eval`, the file has no direct eval or `with`, and the const is not declared in a switch case, since its scope is the whole switch.
  This undoes the CONTROL_FLOW_INLINE_BOOLEAN and NAMING_BARE_BOOLEAN forms:
  - `const isAsFlag = arg === '--as'; const shouldReadAsNext = isAsFlag && hasNextArg; if (shouldReadAsNext) flags.as = nextArg` becomes `if (arg === '--as' && hasNextArg) flags.as = nextArg`.
  - useSwarmTasks.ts:10-11 and useSwarmFeed.ts:11-12 then hash the same.
- A fn unit hashes a signature node ahead of its body: arrow or function, async, generator, accessor kind, and each param's canonical pattern, so `(a, b)` never equals `(b, a)` (#2586).
- A JSX component name (`<Foo>`, the root of `<foo.Bar>`) resolves through bindings like any identifier. A dynamic `import('x')` or global `require('x')` source becomes the `import:<src>#*` anchor. TS enums, namespaces, `import =` and `export =` are runtime code and are kept, and `declare`, `abstract` and `const` are labels.
- `if (c) s` becomes `if (c) { s }`.
- An expressionless template literal becomes a string.
- `Boolean(x)` in test position becomes `x`.
- Static Vue attributes are sorted; directives keep their order. A static never sorts across a spread, a bind or v-model of its own name, or a dynamic `[name]` bind, because the later of two writes wins (#2586). Template text keeps the whitespace that renders (JSX text rules, Vue's condensed text, raw `<pre>`), and expression text keeps string literal contents.
- Soundness is property-tested: the original and canonical forms evaluate equal on generated inputs.

3. HASHES
Merkle: h(node) = mix(type, label, children). Two murmur3-32 lanes give 16 hex chars.
- **L1:** unit-local binders become #k in first-use order. File-bound outer identifiers become captures @k. Imported bindings and non-trivial globals keep their names; these are the anchors. Literals, member names and keys are kept.
- **L2:** like L1, plus:
  - literals become STR, NUM, REGEX, TPL(n) or BOOL;
  - null, undefined, {} and [] become VAL;
  - non-call member properties on non-anchor receivers, and object keys, become KEY. So flags.as and flags.to collide.
  Callee method names (startsWith, relative) stay anchors.
- **L3:** like L2, plus every maximal anchor-free expression becomes E.

Templates:
- The tag is the PascalCase component name.
- A static attribute value matching /^[a-z][a-z0-9-]{0,15}$/ is a ROLE token.
- Other static text becomes STR at L2.
- `:x` becomes BIND(x) with an EXPR hole. v-if, v-for and v-show are structural with an expression hole. `@e` becomes EVENT(e). Slots are named. Children become TEXT or INTERP.
- class, style, key, ref and id are passthrough, not hashed.
- Static `tone="x"` and bound `:tone` both become ATTR(tone) with a value hole at L3.

4. MASS, ANCHORS, EVIDENCE
- mass is the number of canonical nodes.
- anchorWeight, summed over distinct anchors:

| Anchor | Weight |
|---|---|
| Imported binding | 2 |
| Non-trivial global (fetch, JSON, process, document, Promise, URL, Error, Array) | 2 |
| Member-call name | 1 |
| L1 string literal | 1 |
| Numeric literal other than 0/±1 | 0.5 |
| Regex | 2 |
| L1 object key | 0.5 |

- An anchor present in more than 40% of the facet's files is ubiquitous and weighs 0. Examples: .length, Boolean, String.
- E = mass + 3*anchorWeight.

Gates:

| Gate | Applies to | Requirement |
|---|---|---|
| G1 | L1 groups | E >= 18, mass >= 8 |
| G2 | L2 fn/stmt/window groups | E >= 30, anchorWeight >= 2 |
| G3 | L3 groups | mass >= 40, E >= 50; LGG mandatory |
| G4 | Templates | mass >= 10 (attributes count) |

Instance rules:
- Cross-file groups need at least 2 files. A 2-instance group needs G2, or G1 with anchorWeight >= 3.
- Within-file groups need at least 3 instances and go only through W.
- Template groups need at least 3 instances.
- An expr group with more than 25 instances across more than 10 directories and E < 35 is labeled `idiom` and shown only with --idioms.

5. GROUPING PATHS (deterministic: ORDER BY file_path, start)
- **N1 exact buckets:** `GROUP BY fp, facet_key HAVING count(DISTINCT file_path) >= 2`. fp1 is used for all kinds (G1), fp2 for fn and stmt (G2), and fp3 for fn and stmt (G3, then LGG). The fp3 bucket is new, and it is how A21 is found: the bodies differ only in an anchor-free object literal under JSON.stringify.
- **N2 cross-file statement windows:** repeated k-grams (k = 2..6) over per-block fp2 sequences, maximal windows only. A window that contains `return` must reach the end of the function body.
- **N3 name-anchored near-miss:** an identical decl_name in the same facet, in at least 2 files, with equal fp3. One variant hole is allowed.
- **W within-block siblings** (replaces N5; non-contiguous instances allowed). This is how A1 is found despite the interleaving at team-flags.js:69-73, :100-104 and :123-124.
  - For each block, bucket its canonical windows (k = 1..6) by fp2.
  - Keep a bucket with at least 3 non-overlapping instances, each of mass >= 8, totalling at least 36.
  - Then merge same-block buckets with equal fp3 through LGG. The parseInt and String variants merge this way with a transform hole.
  - Template siblings under one parent are handled the same way, at tmpl fp2.
- **T templates:** cross-file tmpl buckets at fp3, then role refinement (section 7).
- **Library match:** a unit whose fp1 or fp2 equals a lib_piece fp or alias, in the same facet, gives a reuse blueprint.

6. ANTI-UNIFICATION
n-ary LGG in one simultaneous walk. Equal (type, label, arity) recurses; any other difference becomes a hole keyed by the tuple of member-subterm L1 hashes, and equal tuples share a hole. Hole kinds:
- literal or value: a param
- key: a param or table column
- ref: a param
- expr: a value param
- transform: one side is a call whose argument is L1-equal to the other side. It becomes a callback or coerce column with an identity default.
- optionalStmt: only inside N2 windows, at most 1, as a hook callback
- capture: identical but outer-bound; it becomes a param, and more than 2 are bundled into an options object

Rejections (stored with the reason code):

| Code | Rejects when |
|---|---|
| R1 | More than 4 differing holes. All-leaf holes in W are allowed up to 8, as table columns. |
| R2 | holeNodes/mass > 0.30 (0.35 for templates) |
| R3 | A hole references a binder introduced inside the unit (catch param, loop var, local const) |
| R4 | A hole or optionalStmt contains return, break, continue, yield or throw |
| R5 | A non-transform hole swallows anchors in at least half the members |
| R6 | The facet is not homogeneous |
| R7 | The LGG matches a library convention entry |
| R8 | More than 3 captures after bundling |

Drift:
- A unit whose anchor set is a strict subset (2/3 overlap or more) of an accepted group's, with the same root shape, is role=drift.
- Drift is reported, becomes a decision hole, and is never auto-healed.

7. TEMPLATE REFINEMENT
- ROLE tokens on structural attributes (default `variant`, `as` and `type`, plus slot names) below the root element are never holes. Different child roles mean different structure.
- ROLE tokens on the root element and on other attributes (tone, size) may become variant holes.
- A bucket whose LGG fails R1/R2 is partitioned by the tuple of structural ROLE values, earliest preorder first, recursively. Partitions that pass G4 and the rule of 3 survive.
- A tag difference is never a hole.

8. RANKING
- score = (instances-1) * mass * (1-holeRatio) * placementOk * levelWeight * (spec ? 0.5 : 1).
- levelWeight: L1 1.0, L2 0.9, W 0.8, N3/L3 0.6, library 1.2.
- placementOk = 0 when there is no same-facet host inside one package root. Such a group is an observation only.
- A group whose instances are all contained in a higher-scored group is folded into it, or linked through dependsOn when it is a proper sub-piece (A5 under A4, A8 under A7, A23 inside A21).
- The top 20 are surfaced; all groups are stored.

TRUE TRACE
- **A1 (W):** after alias inlining each two-form flag is two canonical statements, and they collide at L2 (KEY for flags.x, STR for the names). The int and parent-parse variants merge at fp3 with a transform hole. The equals-only singles form a second W bucket. The result is a tabulate blueprint with a `spaced` column.
- **A2 (N1 L1):** the identical flagValue pair. Mapping it to readFlagValue needs a learned alias; license.js and config are missed.
- **A3 (N2 window):** a tail window with a superset conjunct, recorded as a behaviorDelta.
- **A4 (N1 L1 expr):** `#0.startsWith('..') || path.isAbsolute(#0)` after De Morgan. Host is cli/path-scope.js. typecheck-command:42 and team-dispatch-batches:38 are drift.
- **A5:** an N2 window, dependsOn A4.
- **A6, A10, A11:** N3 (same names). A10's regex is a decision hole. A11 has one variant hole.
- **A7 (N1 L2 try unit):** E about 32, 5 or more files. B8 members are rejected by R3/R4.
- **A8:** an N2 window, dependsOn A7.
- **A12:** an N1 L1 fn and the inline conditional.
- **A13:** borderline. mass is about 7, which fails G1 mass >= 8, so it is likely partial.
- **A14:** an N2 tail window.
- **A15:** an L1 expression statement with 31 instances.
- **A16:** an L1 two-statement N2 window in spec facet.
- **A17:** the mkdtemp expression only.
- **A18:** library match on envelope.textItem once it is harvested as a project piece. Otherwise missed.
- **A19 (W):** 4 sibling blocks.
- **A20:** partial. The common fetch/json/assign N2 window is found; the isLoading variants exceed the gap limit.
- **A21 (N1 fp3 + LGG):** holes are url STR, the body expr and refetch ref. error is a capture.
- **A22:** N1 L2 on the useSelfCleaningTimeout call. Holes are NUM and the tick ref.
- **A23:** L1 expr, folded into A21.
- **A24 (T):** refinement gives 11 instances in 3 files.
- **A25 (W template):** 5 siblings.
- **A26:** missed (Type-4-ish).

FALSE TRACE
- **B1, B11:** no L1 or L2 collision, and build.js:79 fails G1 (anchorWeight 0). PREDICATE_LOGIC is deleted.
- **B2:** the structural child variant order differs (caption>title, title>caption, title>body), so each partition has fewer than 3 instances.
- **B3:** excluded path, plus three facets.
- **B4:** different runtime facet, different anchors, different names.
- **B5:** different anchors. Under L3 the holes trip R4/R1.
- **B6:** R7 toc-view convention, plus G4.
- **B7:** R7 capsule-controller-return convention. A shorthand return has anchorWeight 0.
- **B8:** R3 (catch binder used in a hole) and R4 (throw).
- **B9:** different node types (literal side, slice arity).
- **B10:** different subtree (slots, chip, badge).
- **C1:** R1/R2.
- **C2:** in-file count of 2, below W's minimum.
- **C3:** R4 return holes.
- **C4:** an A12 member with a trim variant, as a behaviorDelta.
- **C5:** an A20 weak member.
- **C6:** only the identical triple.
- **C7:** inside A15.

## Library

ONE REGISTRY (cli/library/registry.js), loaded in id order, with four entry roles.
- **piece:** extractable or reusable code.
- **resolution:** the one shape that satisfies a set of conflicting rules.
- **convention:** a house shape that suppresses detection (R7).
- **exemplar:** a rule's good/bad shape.

KIT LAYOUT. Entries ship at the kit root as `library/<facet>/<id>/`, a sibling of blueprints/ and excluded from detection. Each holds:
- `entry.json`
- `piece.<js|ts|vue>`: concrete, fully filled code using the default hole values, so it parses, audits and typechecks as written. There is no placeholder syntax.
- `piece.spec.<js|ts>`: real behaviour tests on tmpdir or real fs. No mock data.
- `negative/*`: verbatim real code that must NOT match, with provenance. For read-json-or these are ratchet.js:37-48 and workspace.js:10-16.
- Optional `ambient.d.ts`, used only by the sandbox typecheck.

Facets are node-js, ts, vue-ts, vue-sfc and react-tsx.

entry.json fields:
- id, version (semver), role, facet {lang, runtime, framework}, exportName, defaultModule
- signature, params [{name, kind, type?, default?}]
- holes [{id, kind: name|wording|type, default, locate: {identifier}|{commentText}|{stringLiteral}}]. Holes point into the concrete piece by identifier or by exact text.
- fp {l1, l2, l3}, aliases [{fp, level, source, from}]
- canonicalFor: rule ids
- conflictsResolved: [{rules, note}]
- verifiedRuleset {version, revisionsHash}, status: verified|quarantined|retired
- provenance

SEED. Kit seed entries are generic idioms only. Project-specific shapes (m-stat-tile, post-json-then, json-columns, leaseKeys) must come from harvest, so recall from kit seeding is measured separately.
- node-js pieces: read-json-or (defaultModule cli/fs-json.js; JSDoc-typed; its catch carries a reason comment so it satisfies ERROR_SWALLOWED_EXCEPTION and AI_SLOP_SHALLOW_CATCH), is-path-inside, relative-if-inside, git-root.
- vue-ts piece: visible-poller.
- vue-ts resolution: nullable-timer-handle.
- Conventions: capsule-controller-return (vue-ts), toc-view (vue-sfc), framework-mirror (any).
- hooks/*.ts become react-tsx pieces in a later light task.

THE CONFLICT RESOLUTION (fixes the blocker). vue-ts/nullable-timer-handle is the form that has landed in src/ui/composables/useSelfCleaningTimeout.ts:4-11:
- `let timerId: ReturnType<typeof setTimeout> | undefined;`
- `const stop = () => { clearTimeout(timerId); timerId = undefined; isRunning = false; };`
- `const hasActiveScope = Boolean(getCurrentScope()); if (hasActiveScope) onScopeDispose(...)`

How it satisfies all three constraints at once:
- There is no branch, so there is no inline boolean and no let-narrowing through an alias.
- clearTimeout's argument is the handle identifier itself. collectTeardowns keys cleared handles by toSourceKey(arg) (cli/audit/lifecycle-predicates.js:42-79), so TIMER_DISCIPLINE sees the handle as cleared.

It is canonicalFor CONTROL_FLOW_INLINE_BOOLEAN and TIMER_DISCIPLINE. Its negative fixtures pin both failure forms:
- `const id = timerId; const hasTimer = id !== null; if (hasTimer) clearTimeout(id)` must report TIMER_DISCIPLINE: the key is 'id' while the handle key is 'timerId'.
- `if (timerId !== null) clearTimeout(timerId)` must report CONTROL_FLOW_INLINE_BOOLEAN.

A new precondition helper narrowsMutableRef(test, consequent) adds a remedy line to the INLINE_BOOLEAN hazard. It fires when a test compares a `let` or mutable member to null/undefined and the consequent uses it. The remedy reads `canonical: chemx library show vue-ts/nullable-timer-handle`, so agents are pointed at the resolution instead of aliasing the test.

RULE EXEMPLARS
- `chemx library sync-fixtures` generates `library/exemplars/<RULE>.json` from FIXTURES in cli/audit/rule-fixtures.spec.js: {rule, good, bad, fpGood, fpBad}. Sized fixtures (LINE_BUDGET_FILE etc.) are stored as `generate: {fn, n}` and served by fixture-gen.js.
- Exemplars are used three ways:
  - (a) as few-shot "shape we want" context in hole-fill prompts;
  - (b) as the all-rules fixed point: every good fixture reports zero violations of ANY rule under atomic-strict, and every exemption needs a `conflicts` entry and a Friction task id;
  - (c) as a heal-time guard: rendered code whose subtree fp2 equals an exemplar fpBad is refused before write.
- Rule-interaction matrix: every piece and every good exemplar is audited under every rule. Autofix (autofix-content.js) applied to any of them must be a no-op. A rule pair that cannot be satisfied together becomes a rule_conflicts row plus a resolution-entry requirement.

PROJECT PIECES. These are pointers, never code copies.
- Stored as `.chemx/library/<id>.json` = {module, exportName, fp, aliases, facet, provenance}, mirrored into lib_pieces.
- They come from verified heals (learn) or `chemx library add cli/path-scope.js#isPathInside`.
- A curated `chemx-library/` directory at the project root holds the user's own shapes in the kit format. `chemx library sync` discovers it.
- Reuse is offered only within the same facet and the same package root (nearest package.json). A kit piece is never imported across packages. It is instantiated as a new project module with `fromPiece`.

VERIFICATION SPEC (cli/library/library.spec.js, part of `chemx verify`). For every kit or curated entry:
- (i) It parses with source-parse.js strict or the SFC parse.
- (ii) auditCode under the atomic-strict profile with ALL rules gives 0 violations.
- (iii) Typecheck through `chemx typecheck --sandbox <tmpdir>`: vue-tsc or tsc --strict for ts/vue, and `--allowJs --checkJs --strict` for JS pieces, which therefore carry JSDoc.
- (iv) piece.spec passes.
- (v) The recomputed fp equals entry.json, so the fingerprinter and the library cannot drift.
- (vi) The piece fp matches each of its own aliases, and no negative/* matches.
- (vii) The exemplar fixed point and the interaction matrix hold.

VERSIONING
- A piece edit bumps semver. Aliases accumulate. A removed export makes a project piece orphaned, and its aliases stop matching.
- On a RULESET_VERSION or RULE_REVISIONS change, `chemx library verify` re-runs (milliseconds per entry). Passing entries are re-stamped automatically. Failing ones become quarantined: still used for detection, refused for heal, with a task "Library: <id> fails <RULE> after ruleset <v>" (needs standard).
- Blueprint ids do not include the ruleset. Heal always re-verifies under current rules, so a rule bump does not invalidate unrelated open blueprints.

## Blueprint

SCHEMA chemx.blueprint/1
- Canonical JSON with sorted keys, LF line endings and no timestamps.
- id = 'bp_' + sha256(canonical body without id/status)[0..12].
- The body depends only on the extractor version, the member content hashes and offsets, the LGG, the placement and piece@version. It never depends on the ruleset or the clock.
- Fills live in blueprint_fills, so (blueprint, fills) is the full, replayable input of a heal.
- Line ranges are informational. Heal re-locates each member by its fp inside the file and refuses only when the member's body hash changed.

EXAMPLE (ground truth A7, N1 L2 try units; real sites)
```json
{
  "schema": "chemx.blueprint/1",
  "id": "bp_<sha12>",
  "group": "pg_<sha12>",
  "path": "N1:fp2",
  "kind": "extract-function",
  "facet": { "lang": "js", "runtime": "node", "module": "esm", "spec": false, "packageRoot": "." },
  "extractor": 1,
  "evidence": {
    "instances": 5, "files": 5, "mass": 17, "anchorWeight": 5, "E": 32, "holeRatio": 0.12,
    "anchors": ["JSON.parse", "fs(node:fs)", ".readFileSync"],
    "rejectedMembers": [
      { "at": "cli/workspace.js:10-16", "reason": "R3 catch binder `error` in hole ([value,error] tuple)" },
      { "at": "cli/audit/ratchet.js:37-48", "reason": "R3+R4 tri-state error contract" },
      { "at": "cli/doctor/check-mcp.js:14-21", "reason": "R3 ENOENT mapping reads `error`" },
      { "at": "cli/commands/cmd-wrappers-json.js:13-16", "reason": "R4 throws" }
    ]
  },
  "lgg": "try { return JSON.parse(fs.readFileSync($file, 'utf-8')); } catch { return $fallback; }",
  "piece": {
    "name": "readJsonOr", "module": "cli/fs-json.js", "moduleIsNew": true, "export": "named-const",
    "fromPiece": "node-js/read-json-or@1.0.0", "home": "cli/doctor/check-host.js:16-20",
    "signature": "export const readJsonOr = (file, fallback) =>",
    "params": [
      { "name": "file", "kind": "ref", "from": "majority identifier at hole" },
      { "name": "fallback", "kind": "value", "values": ["{}", "null"] }
    ],
    "imports": [{ "from": "node:fs", "default": "fs" }],
    "body": "import fs from 'node:fs';\n\n/**\n * Parsed JSON from file, or fallback when it is missing or unparseable.\n * @param {string} file\n * @param {unknown} fallback\n * @returns {unknown}\n */\nexport const readJsonOr = (file, fallback) => {\n  try {\n    return JSON.parse(fs.readFileSync(file, 'utf-8'));\n  } catch {\n    // missing or unparseable: the caller chose the fallback\n    return fallback;\n  }\n};\n"
  },
  "callSites": [
    { "file": "cli/doctor/check-host.js", "range": [16, 20], "contentHash": "<sha>", "memberFp": "<fp2>",
      "args": ["file", "{}"],
      "after": "// missing or unparseable settings count as \"no hooks\"; install-hooks reports parse errors\n  return readJsonOr(file, {});",
      "addImport": { "from": "../fs-json.js", "names": ["readJsonOr"] }, "dropUnusedImports": ["fs"] },
    { "file": "cli/hooks/project-status.js", "range": [12, 16], "args": ["file", "null"], "addImport": { "from": "../fs-json.js", "names": ["readJsonOr"] } },
    { "file": "cli/doctor/kit-locate.js", "range": [11, 15], "args": ["file", "null"], "addImport": { "from": "../fs-json.js", "names": ["readJsonOr"] } },
    { "file": "cli/build/detector.js", "range": [27, 31], "args": ["pkgPath", "null"], "absorb": "preceding existsSync guard with equal fallback", "addImport": { "from": "../fs-json.js", "names": ["readJsonOr"] } },
    { "file": "cli/project-detector.js", "range": [8, 12], "args": ["cfgPath", "{}"], "addImport": { "from": "./fs-json.js", "names": ["readJsonOr"] } }
  ],
  "children": [
    { "reason": "transform hole (JSONC stripJsonc wrapper)", "at": "cli/sfc/module-aliases.js:41-47", "needs": "standard" },
    { "reason": "post-validator variant", "at": ["cli/audit/status-file.js:27-33", "cli/config/index.js:11-17"], "needs": "standard" }
  ],
  "dependsOn": [],
  "unblocks": ["bp_<A8 readPackageField>"],
  "drift": [],
  "behaviorDelta": [],
  "holes": [
    { "id": "name", "kind": "name", "tier": "light", "default": "readJsonOr", "candidates": ["readJsonOr", "readJsonFile"],
      "constraints": { "identifier": true, "noCollision": "symbols table, package scope" } },
    { "id": "doc", "kind": "wording", "tier": "light", "default": "Parsed JSON from file, or fallback when it is missing or unparseable.",
      "constraints": { "maxLen": 120, "rules": ["TYPOGRAPHY_EM_DASH", "AI_SLOP_*"] } }
  ],
  "verify": {
    "parse": true,
    "audit": "all rules; zero introduced (rule:hazard delta) on touched files; zero on the new module",
    "typecheck": "piece: sandbox checkJs-strict; sites: checkJs delta (reported as 'delta' because cli/ is not under checkJs)",
    "specs": { "direct": ["cli/build/detector.spec.js", "cli/project-detector.spec.js"], "reverseImportsDepth": 2, "addPieceSpec": "cli/fs-json.spec.js <- library/node-js/read-json-or/piece.spec.js" },
    "postCondition": "re-fingerprint touched files: group fp2 count <= 1 (the piece itself)"
  },
  "locks": ["cli/fs-json.js", "cli/fs-json.spec.js", "cli/doctor/check-host.js", "cli/hooks/project-status.js", "cli/doctor/kit-locate.js", "cli/build/detector.js", "cli/project-detector.js"],
  "needs": "light",
  "autoApplicable": true,
  "task": { "rule": "PATTERN_EXTRACT", "title": "Extract readJsonOr from 5 JSON readers (cli/)", "parent": "<pattern epic>" }
}
```

How the fields are derived:
- `body` is the home instance's original text, or the kit piece's concrete code when `fromPiece` is set, with hole spans replaced by parameters. It therefore carries code that already passes the audit.
- Each call site's `after` is `return <name>(<args verbatim>)`, because the try is in tail position.
- Comments inside a replaced span are hoisted above the replacement.

OTHER KINDS
- **tabulate** (A1, A19, A25):
  - `table {name, placement: module-const-before-fn | controller, columns, rows: [[verbatim subterms]]}` and `loop {over, bodyFromLgg}`.
  - Transform holes become a coerce column from a fixed set {String, toInt, toFloat, parseParentFlagValue}.
  - For A1 the `spaced` column keeps the =-only flags behaviour-identical. Fixing the `split('=')[1]` truncation is listed as a behaviorDelta, which makes the blueprint standard.
- **extract-component** (A24):
  - `scaffold: chemx m-stat-tile` runs through the generator (blueprints/molecule-capsule), so the capsule layout is generated, not hand-built.
  - props come from the holes plus their role tokens: label:string, value:string|number, tone?:TextTone, variant?:'subtle'|'glass'. class is passthrough.
  - Each site is replaced with `<MStatTile label="..." :value="..." variant="glass" class="..." />`, with the expressions copied verbatim.
- **reuse** (library match, A10, A18): `piece.existing: 'cli/terminal.js#stripAnsi'` plus behaviorDelta entries.
- **advisory** (an L3 group with gaps over the limit, e.g. A20): `apply: false`, needs deep. It becomes a design task.

HOLES AND NEEDS
- **params[]** are deterministic. They come from the LGG plus naming:
  - majority subtokens over 50% of members, preferring a verb or is/has prefix;
  - otherwise the hole context: object key, member property, neighbouring identifier.
- **holes[]** are judgment holes. Every one has a deterministic default when one exists, a tier and constraints.
  - name, wording, literal: light.
  - type, variant, decision (drift adoption, behaviorDelta acceptance, canonical variant choice): standard.
  - design (no placement, a cross-module store): deep. It is never auto-healed.

needs = max(open hole tiers, kind floor, escalations):
- **light:** only defaulted name or wording holes, 6 files or fewer, no behaviorDelta, kind extract-function, reuse or in-file tabulate.
- **standard:** any type, variant or decision hole; any behaviorDelta or drift; extract-component; 7 to 15 files; or a site with no covering spec.
- **deep:** advisory, more than 15 files, or new public API across package dirs.

`autoApplicable` is true only for a light blueprint whose holes are all defaulted and which has no behaviorDelta.

## Heal

ENTRY POINTS
- CLI: `chemx heal <bp> [--dry-run] [--fill id=value ...] [--collapse-wrappers] --as=@h`, and `chemx heal --undo <run>`.
- MCP action `heal`. It is mutating, so it is refused without a resolved root.
- Heal never commits; the owning session commits, per the protocol.

DETERMINISTIC PART
A closed set of serializable span ops on the original text. Spans come from Babel start/end, or from Vue compiler loc offsets through the SFC overlay. Nothing is reprinted (the kit has no @babel/generator or recast), so bytes outside the spans are unchanged.
- **createModule {path, content}** and **insertExport {path, after, content}**. In a host module (e.g. cli/path-scope.js for A4), one copy becomes the export and the in-file copies become calls.
- **replaceRange {file, start, end, expectHash, text}**. Indentation is re-based to the site.
- **addImport {file, from, names}**. The path is relative and POSIX. Extension style follows the file's majority (.js for cli/ ESM; extensionless or the alias for TS). It merges into an existing import from the same module, including the `import x, { y }` form, and side-effect imports are never touched.
- **dropUnusedImports {file}**. Uses Babel scope on the new text and removes only specifiers that now have zero references.
- **hoistComments**: comments inside replaced spans are re-emitted above the replacement in source order.
- **tabulate {file, runRanges, tableAt, tableText, loopText}**.
- **scaffoldCapsule**: runs the existing generator (generator.js and generator-writes.js, the `chemx m-<name>` path), then replaceRange into the generated template and types.d.ts.
- **collapseWrapper**: opt-in with `--collapse-wrappers`, because removing code is ask-first. Exported members with external importers (imports table) become an adapter or a re-export and are never deleted.

Arguments are each site's verbatim source slices, so behaviour is preserved by construction except for the listed behaviorDeltas. Those are never light and never auto-applied.

MODEL-FILLED PART
Only open holes go to a model. It receives the blueprint, the hole list, about 40 lines of context and the relevant exemplars and conventions, and returns a JSON object {holeId: value}. Validation of each fill:
- name: a valid identifier or kebab file name, unbound at every target scope (path.scope.hasBinding), and not already exported by the host.
- wording: maxLen, no RESIDUE_REGEX hit (autofix-content.js), and auditCode clean for TYPOGRAPHY_EM_DASH and AI_SLOP_*.
- type: parses as a TS type.
- variant or decision: one of the listed options.
Fills never contain free code. A fill that fails validation re-opens its hole with the error. After two failures the hole's tier goes up by one.

SAFETY SEQUENCE
1. **Staleness.** Re-locate each member by fp in the current AST. Refuse with BLUEPRINT_STALE only when a member's body hash changed, then `chemx blueprint <group>` regenerates it. A kit piece must have status verified under the current ruleset; a quarantined piece is refused.
2. **Locks.** Acquire leases for every path in `locks`, as `--as` with purpose `#<task>`. Any foreign lease (findForeignLease) refuses the whole heal with CHEMX_FILE_LOCKED. There are no partial heals.
3. **Plan in memory.** Run all ops, then the exemplar fpBad guard on the piece and the replacements. Run `chemx lint --fix` scoped to the touched files when the package has a lint config; otherwise it is reported as skipped.
4. **Baseline.** auditCode of each touched file before the edit gives a set of (rule, enclosing unit, normalized hazard) keys. Typecheck diagnostics for the touched files come from a cache keyed by file hash.
5. **Apply** through applyEdits (cli/apply-edits.js:115): parse check per file, declaration-loss check (allowRemoved only for collapseWrapper), atomic writes with backups, and a restore of every file on any write error.
6. **Verify.** Every step is required:
   - (a) parse;
   - (b) an all-rules audit of the touched files, their same-directory siblings (for cross-file rules) and the new module. Introduced keys must be 0, and the piece itself must have 0 violations. Pre-existing violations do not count against the heal;
   - (c) typecheck: `chemx typecheck` scoped to the package for ts and vue; for JS the piece gets the sandbox checkJs-strict and the sites a diagnostic delta. The verdict always states which mode ran; nothing is skipped silently;
   - (d) covering specs: the direct specs plus reverse imports at depth 2 from the imports table, plus the piece spec, through `chemx test <files>`;
   - (e) for extract-component, the SFC compiles;
   - (f) post-condition: re-fingerprint the touched files. The group key may now appear no more often than the piece's own exports, every file stays under 500 lines, and the index is micro-synced through the patcher.syncIndex path.
7. **Rollback on any failure.**
   - Restore from the applyEdits backups and sha-check that every file is byte-identical.
   - heal_runs.outcome = rolled_back with the stage and up to 20 lines of output.
   - The blueprint becomes rejected, and the task is blocked with a one-line reason.
   - If the failing violation is canonicalFor-covered by a resolution entry, the verdict is `use piece <id>` and a child blueprint is planned from that piece. If it is a genuine rule conflict, a rule_conflicts row is written and a `Friction: heal <bp> rejected at <stage>` task is filed.
   - The heal never retries with free-form code and never reverts a rule fix to the hazardous form. That is exactly the useSelfCleaningTimeout 4d327ef loop.
8. **Success.**
   - heal_runs gets diff_receipt, the verify results, the model, the tokens and the outcome, and agent_tasks.diff_receipt is set.
   - The agent commits one blueprint per commit (`refactor(patterns): readJsonOr from 5 sites [bp_…]`), runs `chemx verify`, releases the locks and runs `team task done --target=<piece module>`.
9. **Learn.**
   - Register the export as a project piece. Its fp is the new body; its aliases are the members' fp1 and fp2.
   - Later copies of the same form raise PATTERN_REINVENTED and get a zero-hole reuse blueprint.
   - patch and write results gain `reuseHint {piece, import}`. It is non-blocking at first and can be ratcheted to blocking per entry.

ROLLBACK AFTER COMMIT: `git revert <sha>`. `chemx heal --undo <run>` restores uncommitted runs only while each file's current hash equals its after-hash; otherwise it refuses and names the file.
