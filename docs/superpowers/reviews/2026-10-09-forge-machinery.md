# Report for #2523: how pattern detection and the roadmap work today

All paths are under `/home/xopher/www/x/Xophz-COMPASS/apps/chemical-x/starter-kit`. I made no edits or claims. I ran one in-process `runAudit('.')` through `node -e` to get real output; it took about 32s for 633 files and writes nothing.

## 1. Where patterns are recorded (`cli/audit/pattern-detector.js`)

**Plumbing**
- `runAudit` creates one registry (`cli/audit-engine.js:28`) and passes it through `scanTree` (`:33`) and `auditFileEntry` (`cli/audit-scan.js:75-81`). Single-file `auditFile` passes no registry (`audit-scan.js:52`).
- In `collectRawViolations` (`cli/audit/rules.js:68-99`), Vue templates go to `recordTemplatePatterns` via `runSfcTemplatePasses` (`rules.js:56-59`). Script and JSX go through `runAstPasses`, where `createPatternVisitors` is merged into the same Babel traverse as the rule visitors (`cli/audit/ast-passes.js:66-68`).
- Recording is skipped when `options.fast` is set or the file is not Babel-parsable (`rules.js:74`).
- `.cs`, `.py`, `.go`, `.rs`, `.java`/`.kt` and C/C++ files get only text passes, so they never record patterns (`cli/languages.js:40-87`, `rules.js:47`).
- The patterns appear in `report.patterns` (`audit-engine.js:89,109`).

**The registry** (`pattern-detector.js:9-88`)
- `record(type, signature, loc)` puts occurrences into a bucket keyed `${type}::${signature}` (`:12-30`).
- A bucket becomes a candidate when it has `>=2` unique files, or `>=3` files if `ruleOfThree` is set.
- `ruleOfThree` defaults to true in `audit-engine.js:89`. If any occurrence is in one of the top-5 hotspot files, the minimum drops back to 2 (`:35-41`).
- `impactScore = files * (hotspot ? 3 : 1.5) + totalHits` (`:43`). Candidates are sorted by that score and cut to 12 (`:84`).
- Label, `suggestedCapsule` and `recommendation` are hard-coded per type:
  - `STATE_UNION`: `types/state.d.ts` (`:49-52`)
  - `PREDICATE_LOGIC`: `usePredicateFilter.ts` (`:58-61`)
  - `HOOK_SIGNATURE`: `useSharedController.ts` (`:62-66`)
  - `UI_STRUCTURE`: via `categorizeUiStructure` (`:53-57`)

**Constants:** `MIN_UNION_MEMBERS = 3`, `MIN_CHILD_NODES = 2` (`:6-7`). The predicate minimum of 3 clauses is hard-coded at `:409`, and the hook-return minimum of 3 props at `:432`.

### Why the unrelated predicates group together (`:402-418`)
- The visitor fires on every `LogicalExpression`. It counts `.left` nesting only and ignores the operands entirely.
- The signature is `CLAUSES_${n}_OP_${operator}` and the detail is `"${n}-clause ${op} condition"`. Operand text, identifiers, operand types and the enclosing function are never looked at.
- Any three-way `&&` in any file is therefore the same bucket as any other. Real output from the kit:

| Pattern | Files | Hits | Impact |
|---|---|---|---|
| "3-clause &&" | 106 | 150 | 468 |
| "3-clause \|\|" | 101 | 209 | 512 |

- Five of those buckets carry `hasHotspot=true` (the 3-clause `&&` and `||`, 4-clause `||`, and others), because 101 or more files include a hotspot file.
- Of the 12 emitted candidates, 8 are `PREDICATE_LOGIC` and 3 are `UI_STRUCTURE`. All 8 predicate items point at `usePredicateFilter.ts`.
- `hooks/usePredicateFilter.ts` exists in the kit and is a React hook that imports `useMemo` from `react` (`hooks/usePredicateFilter.ts:1,23-32`). It is a React file recommended for a plain-JS Node CLI.
- The three unrelated sites you named, plus the nesting problem:
  - `cli/agent-json.js:11` is a type guard (`Boolean(item) && typeof item === 'object' && typeof item.file === 'string' && 'line' in item && 'message' in item`).
  - `cli/build.js:79` is `shouldPrint && !isJson && !isSilent && !isRaw`.
  - `cli/cli-args.js:103` is a number-validity check. It is recorded twice, as a 4-clause and a nested 3-clause occurrence, because every nested `LogicalExpression` is visited again.

**Other defects in this detector**
- Sub-expressions are double-counted as described above (`:403-408`).
- The `||`/`&&` mix is ignored. The operator is that of the outermost node only.
- `HOOK_SIGNATURE` reads the name from `functionParent.node.id.name` (`:421-424`). An arrow function assigned to a const has no `id`, so `const useX = () => ({...})` is never recorded.
- `STATE_UNION` (`:366-384`) fingerprints the sorted string-literal set of a TS union. This is the only fingerprint that is actually content-based.

### How UI structures are fingerprinted

**Vue templates**
- `extractTemplateTokens` is a hand-rolled regex and quote scanner (`:181-266`). It does not use `sfc.template.ast`, even though `toTemplateBlock` provides one (`cli/sfc/sfc-parse.js:37-45`).
- `buildTagTree` builds the tree (`:268-291`).
- `getHierarchy` (`:293-302`) emits `tag>(child+child…)`, capped at `depth > 2` (3 levels). It uses tag names only: no attributes, props, slots, directives or text.
- `recordTemplatePatterns` (`:304-332`) records a node when it has `>=2` child nodes and its signature contains `>`. It recurses into children, so nested nodes record their own signatures too.

**JSX** (`:338-363`, `:386-400`): the same signature built from `JSXElement` children, with the same thresholds.

**Svelte:** `parseSvelteSfc` returns `template: null` (`cli/sfc/svelte-parse.js:42`). Svelte templates are never fingerprinted.

**Naming** (`categorizeUiStructure`, `:90-175`)
- It is a substring ladder over the signature text:
  - `svg`/`path+path`/`polygon`/`circle` gives `a-icon` or `m-vector-glyph`.
  - `btn` or `button` gives `m-action-header` (if the text contains `span`, `title`, `h1` to `h4`, or the single letter `p`) or `m-button-row`.
  - `chip`, `badge`, `pill` or `tag` gives `m-pill-row` (more than one hit) or `m-status-badge`.
  - `input`, `textarea` or `select` gives `m-form-field`.
  - Anything else gives `m-feature-card` (`:170-174`).
- The role comes from substring matching, not from structure or props.

**Real output from the kit**

| Label | Files | Hits | Target |
|---|---|---|---|
| `ACard>(AText+AText)` | 9 | 17 | `m-feature-card` |
| `template>(AChip+ABadge)` | 6 | 6 | `m-pill-row` |
| `ACard>(AText+ABadge)` | 3 | 9 | `m-status-badge` |

- `m-lock-row.vue:17-21` has a title plus a caption.
- `m-attention-card.vue:26-29` has a title plus a body.
- Both match `ACard>(AText+AText)` because `variant`, `tone` and `text` are not part of the signature.
- The `template` root in the pill-row item is a Vue `<template>` wrapper tag.

## 2. Semantic clones (`cli/audit/clone-detector.js`)
- `detectSemanticClones(db, {threshold=0.85, limit=50})` reads `SELECT file_path, target_name, vector FROM embeddings WHERE target_type = 'file'` (`:18-20`).
- It filters out spec and test files (`:4-8,23`) and compares all pairs with cosine similarity (`:32-54`).
- Pairs at or above the threshold are returned; pairs at or above 0.95 are marked `isExact` (`:51`). The result is sorted and capped to `limit` (`:56-57`).
- It is surfaced only by `chemx audit --clones` and `--clone-threshold=` (`cli/commands/cmd-audit.js:189-201`), and only when an index db is synced. It is reported through `cli/audit/reporter-clones.js`.
- **It finds nothing in practice.**
  - The index writes only `target_type` values `'capsule'` and `'symbol'` (`cli/search-index-write.js:54-63`).
  - My query of `.chemx/index.db` showed capsule = 880 rows, symbol = 2098 rows and file = 0 rows. The query returns no rows.
  - The only place `'file'` is inserted is the spec (`cli/audit/clone-detector.spec.js:26-29`).
- Even with the right target type, the vector is not code structure.
  - The embedding is `feature-hash-128` (`search-index-write.js:10`).
  - It is built from `${mainName} ${tier} ${tokensText}`, where tokens come from `buildFtsTokens` (symbols, props, hooks, imports, path) (`:56,84`).
  - `generateEmbedding` (`cli/embeddings/vectorizer.js:22-53`) hashes camel-split word tokens and character trigrams into 128 buckets.
  - It measures identifier vocabulary, not behaviour or shape.

## 3. Roadmap and prompts

**Phase 1 items** (`cli/audit/roadmap.js:30-51`)
- Items are mapped 1:1 from `report.patterns`: `title = p.label`, `target = p.suggestedCapsule`, `action = p.recommendation`, `locations = first 3 occurrences`.
- If there are no patterns, a generic "Cross-Monolith Pattern Survey" item with target `src/components/molecules/` is used.
- So `usePredicateFilter.ts`, `m-feature-card` and `m-pill-row` come straight from the hard-coded names in section 1.
- Phases 2 to 5 are static text, except for Phase 2 and Phase 3. Phase 2 uses `TYPE_MONOLITH` violations (`:54-75`). Phase 3 uses the top 6 hotspots (`:78-90`).
- Phase text (`phase`, `roi`, `rationale`) is inline literals in this file (`:33-35,56-59,81-83,95-97,117-119`).

**`Command:` lines** (`roadmap.js:219-223`)
- The line is `chemx q "${item.target.split(' ')[0].replace(/->.*/,'')}" --inspect`, skipped if the result contains `*`.
- A non-search target generates a bogus command. For example `Component stylesheets & logic` (`:101`) becomes `chemx q "Component" --inspect`, and `Copy, comments & logs` (`:107`) becomes `chemx q "Copy," --inspect`.
- Other nonsense targets include `chemx audit` (`:123`), `.git/hooks/pre-commit` (`:129`) and the non-existent capsule names.

**Output paths**
- `formatRoadmapSection` (`:139-168`), `formatRoadmapMarkdown` (`:170-194`), `buildSelfHealingRoadmapPrompt` (`:196-236`).
- The prompt hard-codes the `### AI AGENT DISCOVERY & REFACTORING COMMANDS` block (`:202-206`) and `EXECUTION DISCIPLINE` (`:228-233`).
- `formatRoadmapMarkdown` is called from `reporter-markdown.js:157`, and `formatRoadmapSection` from `reporter.js:140`.

**STRICT EXECUTION RULES** (`cli/audit/prompts.js`)
- They are hard-coded literals in each grade prompt builder:
  - Grade F: `:116-122`
  - Grade D: `:166-169`
  - Grade C: `:213-216`
  - Grade B: `:244-248`
  - AI slop: `:277-283`
  - Hotspots: `:317-323`
  - Pillar: `:366-370`
- "Pre-Split Pattern Discovery" is rule 1 at `:117`, `:318` and `:367`.
- `buildAgentCommandsSection` (`:73-79`) holds the shared claim/inspect/verify commands.
- `buildMasterPrompt` (`:420-437`) assembles the grade prompts and dedupes "Act as" lines and the commands block.
- `cli/audit/prompt-rule-lines.js` (46 lines) holds only the `Needs:` line and the backlog `Action:` line per rule (`:31,40-46`).
- Neither prompts.js nor prompt-rule-lines.js consumes patterns. Patterns reach agents only through `roadmap.js`.

## 4. The patterns entry points
- **There is no `chemx patterns` CLI command.** Running it prints `Unknown command "patterns"`. The `chemx --help` command list has no `patterns` entry, although `/home/xopher/www/x/Xophz-COMPASS/CLAUDE.md` tells agents to use it.
- The only entry is the MCP action `patterns` (`cli/mcp/tools.js:247`). The old tool name `chemx_query_patterns` and the alias `query_patterns` map to it (`:271,314`). Its schema is in `cli/mcp/manifests-analysis.js:8-32` and the arg types in `cli/mcp/types.d.ts:51-56`.
- `handleQueryPatterns` (`cli/mcp/tools-patterns.js:8-63`) takes `dir`, `type` (`ALL`, `STATE_UNION`, `UI_STRUCTURE`, `PREDICATE_LOGIC`, `HOOK_SIGNATURE`), `minOccurrences` (default 2, applied to `fileCount`) and `compact` (default true).
- It runs a full `runAudit` every call (`:12`) and returns `{scannedDir, totalCandidates, compact, candidates[]}`.
  - Each compact candidate carries `id`, `type`, `label`, `detail`, `suggestedCapsule`, `recommendation`, `fileCount`, `totalHits`, `impactScore`, `files` and up to 3 `sampleOccurrences`.
  - Non-compact candidates carry `occurrences` instead of `files` and `sampleOccurrences`.
- The `chemx_harmonize_patterns` MCP prompt only tells the model to run it (`cli/mcp/prompts.js:101-114`).
- The `patterns` object is `PatternCandidate` (`cli/audit/types.d.ts:98-110`). Roadmap types are at `:112-125`.

## 5. What the index already holds (`cli/search-schema-ddl.js`)

| Table | Columns (`:5-88`) |
|---|---|
| `files` | `path`, `mtime`, `size`, `tier`, `lines`, `chars`, `health_score`, `hazard_count`, `extractor_version` |
| `symbols` | `file_path`, `name`, `kind`, `is_export`, `start_line`, `end_line`, `signature` (first source line only) |
| `props` | `file_path`, `name`, `prop_type` |
| `hooks` | `file_path`, `name` |
| `imports` | `importer_path`, `imported_symbol`, `source_module`, `resolved_path`, `line` |
| `violations` | `file_path`, `rule`, `severity`, `pillar`, `line`, `hazard`, `directive` |
| `embeddings` | `file_path`, `target_type`, `target_name`, `vector`, `dimensions`, `model`, `updated_at` |
| `fts_index` | FTS5 over name, kind, tier, tokens |
| `audit_snapshots`, `index_meta` | history and meta |

- A custom `vec_cosine` SQL function is registered (`:160-164`).
- Row counts in the real db: 880 files, with symbol kinds `const` 1698, `re-export` 212, `export` 127, `function` 31 and `component` 10.
- Extraction is `extractAstMetadata` (`cli/search-ast.js:193-207`), which is top-level only.
  - `extractModuleMetadata` (`cli/search-ast-module.js:85-103`) records only declarations, exports and imports from `ast.program.body`, plus hook calls from a whole-tree walk.
  - Arrow-function consts are all kind `const`.
  - **There is no function body, no AST fingerprint and no normalized token stream in the index.**
- The index parse is incremental and mtime-based (`cli/search-sync-rows.js:32-37,45`) and runs separately from the audit.
- The audit re-parses every file on every run, with Babel plugins `['typescript','jsx']` (`ast-passes.js:17`). That is the cheap place to compute per-function data.

**Hook points**
- **JS/TS/Vue/Svelte scripts.** `createPatternVisitors` already runs inside the shared traverse (`ast-passes.js:46-69`, merged via `mergeVisitorSets`). Adding `Function`, `ArrowFunctionExpression` and `ClassMethod` visitors there costs no extra parse. It sees `path.getFunctionParent()`, node locations and the enclosing declaration name.
- **Vue templates.** `sfc.template.ast` (Vue compiler AST with props and directives) is available but unused. `isParsed` is false for `lang=pug` and similar (`sfc-parse.js:44`).
- **C#.** `extractMethods` (`cli/audit/csharp-analyzer.js:115-156`) already yields `{name, startLine, body}` from a comment-and-string-masked source (`maskCommentsAndStrings`, `:24-113`). It is regex-based and brace-matched, and it is the natural place for a normalized token stream.
- **Registry.** The registry is pure in-memory per run (`createPatternRegistry`). A richer record means extending `record(...)`'s `location` object. The fake registry in `friction-fixes.spec.js:73` pins the call shape `record(type, sig, loc)`.

## 6. Languages and parsing
- `cli/languages.js:7-88` registers typescript (`.ts`, `.tsx`), javascript (`.js`, `.jsx`, `.mjs`, `.cjs`), vue, svelte, csharp, python, go, rust, jvm and cpp.
- Only the first four have `parser: 'babel'` (`isBabelParsable`, `:131-134`).
- `.vue` goes through `@vue/compiler-sfc` (`sfc-parse.js:63-80`).
  - Script blocks are blanked into an overlay that keeps line numbers.
  - The template comes with its Vue AST and a raw `content` string with `startLine`.
- `.svelte` goes through a regex `<script>` extractor with no template (`svelte-parse.js`).
- The audit parses everything with one Babel option set (`ast-passes.js:17`, `sourceType: 'module'`).
- A separate `cli/source-parse.js` is the strict mutation-safety parser. It uses plugin sets per language and `sourceType: 'unambiguous'` (`:17-23,43-47`).
- The README claims Python, Go and Rust AST coverage ("Structural Regex / AST", `README.md:341-346`). In code they have no pattern recording.

## 7. Specs that pin current behaviour

**`cli/audit/pattern-detector.spec.js`** (113 lines)
- `extractTemplateTokens` (`:11-30`): returns tags in order, skips comments, and handles quoted `>` characters inside attributes (the `:title` attribute in the fixture).
- `recordTemplatePatterns` (`:32-63`): two files with `v-sheet>(x-btn+x-btn)` give a `UI_STRUCTURE` candidate with `detail` equal to `'v-sheet>(x-btn+x-btn)'`, `suggestedCapsule` equal to `'m-button-row'`, `fileCount` equal to 2, and the exact `uniqueFiles`. This test calls `resolveHarmonizationCandidates()` with no options (min 2 files).
- `categorizeUiStructure` (`:65-95`): pins the whole substring ladder:
  - `svg>(path+path)` gives `a-icon`.
  - `div>(span+v-btn)` gives `m-action-header`.
  - `div>(v-btn+v-btn)` gives `m-button-row`.
  - `div>(span+v-chip)` gives `m-status-badge`.
  - `div>(v-chip+v-chip)` gives `m-pill-row`.
  - `div>(label+input)` gives `m-form-field`.
  - `div>(div+div)` gives `m-feature-card`.
- Rule of Three (`:97-112`): 2 files with `{ruleOfThree:true}` yield 0 candidates, 3 files yield 1.

**`cli/friction-fixes.spec.js:72-78`:** `auditCode` on a Vue file with `const cond = a && b && c;` must call the registry with `type 'PREDICATE_LOGIC'` at `loc.line === 15`.

**`cli/audit/clone-detector.spec.js`** (46 lines)
- It builds an in-memory `embeddings` table and inserts `target_type 'file'` rows (`:9-29`).
- It asserts one pair at threshold 0.8, the file names, and `formatCloneReport` text (`:31-40`).
- This spec is what masks the production zero-rows bug.

**`cli/mcp/server.spec.js`**
- `chemx_query_patterns` over `blueprints`: `totalCandidates` is a number and `candidates` is an array (`:61-82`).
- `compact:true`: `data.compact === true`, and if any candidate exists it has `files` and `sampleOccurrences` and no `occurrences` (`:289-314`).

**`cli/audit/prompts.spec.js`**
- `isSubSection` toggles the "Act as…" preamble per grade builder (`:81-235`).
- `buildMasterPrompt` has exactly one "Act as" and one commands block (`:236-297`).
- `deduplicateRefactoringCommands` and the `formatGroupedPromptViolations` Action/Needs lines (`:299-389`).
- It does not assert on "STRICT EXECUTION RULES" or "Pre-Split" wording.

**`cli/docs-drift.spec.js:14-71`**
- It scans `cli/audit/roadmap.js`, `cli/audit/prompts.js`, `cli/mcp/manifests*.js` and `cli/mcp/prompts.js` as guidance files.
- Forbidden text: unpublished `cx`/`cmx` commands, and flat "under 100 lines"-style budget phrasing.
- The README must list every MCP action name, so a new `patterns` replacement or any new action must be added to the README table (`:61-71`).

**No spec pins** `buildRemediationRoadmap` / `formatRoadmapSection` output, `Command:` lines, STATE_UNION or HOOK_SIGNATURE, or roadmap phase text. `rule-fixtures.spec.js` has no pattern-related assertions.

## 8. Related notes
- `docs/superpowers/reviews/2026-10-08-chemx-ideation-backlog.json:157-161` already contains an idea: match detected structures against catalog molecules (MKpiTile etc.) and give roadmap items a `kind: 'reuse'|'extract'`. Its acceptance test names `ACard>(AText+AText)` (17x), the same pattern as above.
- `docs/superpowers/specs/2026-10-06-chemx-truth-and-cost-design.md:342-346` says `patterns` and `roadmap` should move behind `--full` in default audit JSON output.