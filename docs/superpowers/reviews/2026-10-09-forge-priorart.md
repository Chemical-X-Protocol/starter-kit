REPORT: prior art and recommendation for chemx task #2523 (read-only; nothing was edited, claimed, or posted)

## 0. Where the current code goes wrong (kit evidence)
- `cli/audit/pattern-detector.js:12-30`: `record(type, signature, location)` buckets by the string `type::signature`. Two sites are "the same pattern" if and only if their signature strings are equal. There is no similarity measure and no body comparison.
- `:37-41`: a bucket becomes a candidate with 2 or more unique files, or 3 or more under `ruleOfThree`. `:43` scores it as `files*(hotspot?3:1.5)+occurrences`. Size and substance of the code are not part of the score.
- `:58-61`: for `PREDICATE_LOGIC`, the label is "Duplicated Boolean Predicate Topology (<detail>)", the target is hard-coded to `usePredicateFilter.ts`, and the recommendation text is fixed. The signature comes from `:412`. So the clause-count bucketing (e.g. 3-clause `&&`) and the React-hook target are the reported false positive.
- `:62-65`: `HOOK_SIGNATURE` (signature at `:435`) is hard-coded to `useSharedController.ts`. The target is chosen by pattern type, never by the language or framework of the files.
- `:53-57` and `:90-175`: UI structure is categorised by substring tests on the tag-shape signature. The fallback at `:170-174` is "Shared UI Layout Structure (<sig>)" with `m-feature-card`. The signature carries no props, bindings, text roles or slots, so any card with two texts matches.
- Root cause: grouping is by coarse structural shape, with no minimum size. Clone detectors set a minimum size, compare the actual code, and only then generalize.

## 1. Clone taxonomy and what to surface
Roy/Cordy/Koschke types (sources: [Roy and Cordy, 2008 CSER paper](https://research.cs.queensu.ca/home/cordy/Papers/RC_Framework_CSER08.pdf), [survey of evaluation and benchmarking](https://ar5iv.arxiv.org/html/2006.15682), [clone management vision](https://arxiv.org/pdf/2005.01005)).
- **Type 1:** exact, ignoring whitespace and comments.
- **Type 2:** identical structure with renamed identifiers, literals, or types.
- **Type 3:** near-miss, with statements added, removed, or changed.
- **Type 4:** the same behaviour with different syntax. Very few tools detect this ([SLR](https://arxiv.org/pdf/2306.16171)).

What to surface as "extract this":
- **Type 2:** best target. The differences are leaf holes, which map directly to parameters. High precision, cheap.
- **Type 3:** surface only when the differences are few and small (see the hole limits in section 3). Otherwise the extracted function ends up with so many flags that it is worse than the duplicates.
- **Type 1:** surface it, usually as "same function copied", which is a degenerate Type 2 with zero parameters.
- **Type 4:** do not surface from static analysis. It is the main source of noise. The LLM/embedding research ([Semantic Code Clone Detection: Are We There Yet?](https://arxiv.org/pdf/2606.25272)) shows it is not reliable. I only saw the title in search results, not the findings.
- **Not a clone:** the false positives listed in the task (`isDiagnosticRow`, `shouldPrintStart`, the timeout validator) are Type-4-ish at best. They share only boolean-operator topology, which is far below any clone threshold.

## 2. Detection methods
Search results gave me the jscpd and SonarQube thresholds. The rest of this section is my own knowledge, so verify it against the original papers before quoting.

| Method | Type | Precision / recall / cost | Notes |
|---|---|---|---|
| Token n-gram fingerprints with winnowing (MOSS, Schleimer et al. 2003) | 1-2, partial 3 | Fast and linear. Precision is good on long matches and poor on short ones. | Guarantee: any shared run of at least `t` tokens is caught. `t` is the noise-guarantee threshold, `k` is the n-gram size. |
| Token suffix tree / rolling hash over normalised tokens (jscpd, PMD CPD, SonarQube cpd) | 1-2, some 3 | Linear. Recall is high, but results are line-range blobs with no notion of "function". | jscpd core defaults are 50 tokens and 5 lines. Older wrapper docs say 70 tokens. SonarQube's non-Java rule is 100 tokens and 10 lines, and Java uses 10 statements ([metric definitions](https://docs.sonarsource.com/sonarqube/9.9/user-guide/metric-definitions), [community thread](https://community.sonarsource.com/t/how-can-i-define-the-number-of-token-needed-for-duplicated-code/19597)). Both are configurable per language. |
| AST subtree hashing with normalisation (CloneDR, Baxter 1998) | 1-2, 3 by similarity | Precise because it works at syntactic unit granularity. Cost is O(nodes) with bucketing. | Hash every subtree above a size threshold. Candidate clones are subtrees in the same bucket. Then compare for similarity and generalize. Mass thresholds are a minimum node count. |
| Characteristic vectors with LSH (Deckard, Jiang 2007) | 3 | Higher recall, tunable, more false positives. Needs a vector store. | Over-engineering for chemx. |
| PDG-based (Komondoor/Horwitz, Krinke) | 3-4 | Slow and complex. Not worth it for JS/TS/Vue. | |
| Embeddings / LLM | 4 | Slow, nondeterministic, expensive. | Fine as an optional last-pass reviewer that approves or names candidates, never as the detector. |

Noise control, as the mature tools do it (jscpd, Sonar): a minimum token count and a minimum line count, both required. Boilerplate is excluded (imports, license headers, type-only declarations, generated files). Findings are reported per clone group with the size of the duplicated region. None of these tools groups by shape alone.

## 3. Turning clones into reusable pieces
- **Anti-unification / least general generalization (LGG).** It keeps what two trees share and replaces each difference with a hole, plus a substitution that rebuilds each original ([Lippert's series](https://ericlippert.com/2018/11/07/anti-unification-part-6/); [Generalization of Variadic Structures with Binders, 2025](https://arxiv.org/html/2509.25023v1)). Holes become parameters, and the substitutions become the call-site arguments. Choosing a different "rigidity function" gives coarser or finer generalizations, which can be used to drop trivial similarities. Pairwise anti-unification gets expensive across many fragments, so cluster first and then generalize per cluster.
- **Stepwise unification for Java clones** ([Clone Removal in Java Programs as a Process of Stepwise Unification](https://arxiv.org/pdf/1301.2447)): literal differences become introduced parameters. The number of differences decides the form: extract method, or a lambda when there are only one or two small differences.
- **Hole limits (my synthesis, not from the sources):**
  - Abort when holes are more than about 4 parameters, or more than about 30% of the nodes.
  - Abort when a hole is a statement block containing `return`, `break`, `await` or `yield`.
  - Abort when a hole captures a variable bound outside it.
  - Hole kinds map to parameter types: literal becomes a value, identifier becomes a name or key, expression or function becomes a callback, type becomes a generic.
- **Naming.** Take the common identifier subtokens across the fragments (split camelCase), weighted by frequency and kept only if present in the majority of fragments. Prefer the verb-ish token (`is`, `should`, `parse`, `build`, `format`). If there is no consensus, emit a placeholder (`extractedHelper`) and flag it `needsName`. Do not invent a name.
- **Placement.**
  - Use the lowest common ancestor directory of the files, and prefer an existing sibling module (`utils`, `lib`, `helpers`, `shared`) there. If the LCA is the repo root, use a `shared` dir and say so.
  - Derive language and framework from the host files, not from the pattern type: a plain `.js` ESM CLI gets `.js` and a named export; `.ts` gets `.ts` plus generated types; a Vue script gets a composable only if the clone touches `ref`/`computed`/lifecycle; React gets a hook only if the clone calls hooks. This answers the `usePredicateFilter.ts` mistake: a React hook for a Node CLI should be impossible.
  - Refuse to propose a cross-language target. Clones in different languages can only be reported as an observation.

## 4. Vue/JSX template duplication beyond tag shape
My knowledge, not from searches. Normalise each element subtree, then include:
- **Tag and component identity.** Keep the actual component name for `x-*`/custom components and bucket native tags by role. `ACard` and `ACard` differ by what is inside.
- **Props and directives:** the set of attribute names, plus `v-if`/`v-for`/`v-model`/`:prop`/`@event`, with values replaced by holes.
- **Slots:** named slot names and which child sits in each.
- **Text slots by role.** Distinguish static text (a label or heading), an interpolation `{{ x }}`, and an icon. Two cards each with two texts are not the same if one holds a title plus a body and the other a label plus a value. Static strings that differ become i18n-style holes; interpolations become props.
- **Binding structure:** `v-for` over what, conditional branches.
- **Size minimum:** at least 8 to 10 normalised nodes, or a subtree containing both a binding and a directive. A card with two texts falls under the minimum and is rejected.
- **Output:** a new component with props derived from the holes (`title`, `value`, `icon`), slots for child holes, in the framework of the source files (`.vue` for Vue).

## 5. Incremental operation in `.chemx/index.db`
My recommendation, using chemx's existing SQLite index.
- **Table** `fn_fingerprint(file, fn_start, fn_end, kind, lang, norm_hash, shape_hash, node_count, token_count, content_hash)`.
  - `norm_hash`: hash of the subtree with identifiers and literals blanked.
  - `shape_hash`: coarser, with operators and calls kept.
  - `content_hash`: raw hash for incremental invalidation.
- **Incremental:** on each audit, re-fingerprint only files whose `content_hash` changed and delete their rows.
- **Collision query:** `SELECT norm_hash FROM fn_fingerprint GROUP BY norm_hash HAVING count(DISTINCT file) >= 2 AND min(node_count) >= :min`. This is an indexed lookup, so it is cheap. Add an index on `norm_hash` and `shape_hash`.
- **Near-miss candidates:** a second pass over `shape_hash` buckets, or MinHash/winnowed token n-gram sets for pairs. Only compute LGG (the expensive step) on the shortlisted pairs, and cache the result keyed by the two `content_hash`es.
- **Cost bound:** hashing is O(nodes) per changed file. The pairwise LGG is capped per bucket (for example a 50-pair limit).

## 6. Recommended design for chemx

**Unit of analysis**
- **Source (JS/TS):** function, method, arrow function with a block body, and top-level statement sequences (at least 3 statements). Use the parser chemx already uses.
- **Source (Vue/Svelte):** `<script>` functions treated as JS/TS, and `<template>` element subtrees as in section 4.

**Normalisation**
- Rename local identifiers by first-use order.
- Replace literals with a typed hole (`STR`, `NUM`, `BOOL`).
- Keep: operators, property and call names (these carry intent), control-flow kinds, and imported symbol names.

**Thresholds** (starting points, to tune on this repo and measure)
- Minimum 30 normalised AST nodes, about 50 tokens, and 5 lines. This is at jscpd's floor, and below Sonar's 100 tokens and 10 lines.
- Minimum 2 distinct files (3 under `ruleOfThree`). Occurrences in one file are reported as a within-file clone, not cross-module reuse.
- Maximum 4 holes, at most 30% of nodes; no escaping control flow in a hole.
- Raise the minimum for trivial shapes (single boolean expressions, getters, one-liner wrappers), for example 60 nodes, because these are common and low-value. This is what rejects `isDiagnosticRow`, `shouldPrintStart` and the timeout validator: each is well under 30 nodes of mostly operators.
- Exclude test files (or report them separately), generated files (`components.d.ts`), type-only declarations, and import blocks.

**Score (rank, then cut the list)**
`score = (instances-1) * node_count * (1 - hole_ratio) * placement_ok`
- Bonus for a shared identifier stem across instances; penalty for holes that are statement blocks.
- Drop anything below a floor, and keep only the top N per audit.
- `placement_ok` is 0 when no valid same-language placement exists.

**Suggestion record** (replaces `{label, suggestedCapsule, recommendation}`)
```
{ id, kind: "extract-function" | "extract-component",
  name, needsName, lang, file,   // LCA dir + existing module or new
  signature: "export const <name> = (<param>: <type>, ...) => ...",
  params: [{ name, type, kind: literal|ident|callback|slot }],
  instances: [{ file, start, end, args: [...] }],   // substitutions as call-site args
  evidence: { nodeCount, holeRatio, distinctFiles, sharedStem } }
```
- Param names come from the hole's context: object key, property name, or the neighbouring identifier, else `arg1`.
- Param types come from the literal types when the file is TS; otherwise omit.
- Print one line plus the call-site diff for the first two instances. Do not bake pattern text into labels.

**Phase plan**
1. Replace the bucket key `type::signature` with the `norm_hash` bucket; keep the file/hotspot gating at `:37-43`. This alone removes the clause-count false positives.
2. Add the minimum-size gate and the hole analysis.
3. Replace the hard-coded `suggestedCapsule`s at `:51,:60,:65` with the placement function.
4. Extend the UI signature with props, directives and text roles, with the size gate.
5. Optional later: an LLM pass to name and sanity-check the top few suggestions.

**Verification**
- Run on this repo and confirm the three listed predicates do not group, and the "two texts in a card" case is rejected.
- Add fixtures: a real Type-2 pair that must be reported, a trivial boolean pair that must not, and a Vue card pair with different roles that must not.

## Sources
- [Roy and Cordy, clone detection framework](https://research.cs.queensu.ca/home/cordy/Papers/RC_Framework_CSER08.pdf)
- [Survey on clone detection evaluation and benchmarking](https://ar5iv.arxiv.org/html/2006.15682)
- [Software clone management vision](https://arxiv.org/pdf/2005.01005)
- [Systematic literature review of code similarity and clone detection](https://arxiv.org/pdf/2306.16171)
- [Semantic Code Clone Detection: Are We There Yet?](https://arxiv.org/pdf/2606.25272)
- [Clone Removal in Java Programs as a Process of Stepwise Unification](https://arxiv.org/pdf/1301.2447)
- [Generalization of Variadic Structures with Binders](https://arxiv.org/html/2509.25023v1)
- [Eric Lippert, anti-unification part 6](https://ericlippert.com/2018/11/07/anti-unification-part-6/)
- [SonarQube metric definitions](https://docs.sonarsource.com/sonarqube/9.9/user-guide/metric-definitions)
- [SonarSource community: duplicated-token thresholds](https://community.sonarsource.com/t/how-can-i-define-the-number-of-token-needed-for-duplicated-code/19597)
- [jscpd README](https://cdn.jsdelivr.net/npm/jscpd@4.0.9/README.md)

Not covered by the searches: MOSS/winnowing (Schleimer et al. 2003), Deckard (Jiang et al. 2007), CloneDR (Baxter et al. 1998) and the PDG methods. Those claims come from my own knowledge, so check them against the original papers before quoting numbers.

File examined: `/home/xopher/www/x/Xophz-COMPASS/apps/chemical-x/starter-kit/cli/audit/pattern-detector.js`