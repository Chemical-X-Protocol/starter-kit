# Chemical X: Control Flow Lexicon

**Date:** 2026-10-06
**Status:** Awaiting review
**Scope:** Audit rule engine, autofix, predicate library, AGENTS.md directives
**Companion spec:** `2026-10-06-chemx-truth-and-cost-design.md` (supersedes its section 4.1; its section 4.2 on shallow catches stands)

---

## 1. The Standard

> The `if` never asks a question. The question is asked and named before the
> branch, and the `if` reads the answer.

Every conditional test must be a named boolean: an identifier, its negation, or
a call to a boolean-named predicate. A raw comparison, a truthiness check on a
non-boolean value, or inline compound logic in a conditional position is a
violation.

```js
if (hookCount > 5) { }                      // violation: the if asks
const exceedsHookBudget = hookCount > 5;    // the question, named
if (exceedsHookBudget) { }                  // the if reads an answer
```

### 1.1 Rationale

Two reasons, and the second is the stronger one.

**Naming exposes conditions nobody understands.** Consider a real line from
`cli/audit/ai-slop-detector.js:84`:

```js
if (matchIndex <= 0) return false;
```

Naming it forces a question that inline code hides: why `<= 0` and not
`=== -1`? Is index 0 a valid match being silently rejected? The audit cannot
answer that, and neither can a reader, but the act of naming surfaces it. This
rule converts latent bugs into naming problems, and naming problems get noticed.

It already found one. Grade thresholds and file-size tiers are duplicated
across three files (`score >= 90` seven times, `score >= 70` six times,
`lineCount >= 2000` five times, `lineCount >= 1000` five times, spread over
`history.js`, `metrics.js`, and `reporter-utils.js`). Change one and the others
silently disagree. That is the same defect class as the `verify` / `audit`
grade disagreement documented in the companion spec.

**Named conditions make edits safer, for agents and humans alike.** Modifying
`if (exceedsHookBudget)` means editing the definition; the branch is untouched.
Modifying an inline comparison requires re-deriving what the branch means
before it is safe to change. For an LLM the condition arrives pre-resolved as a
single labeled fact rather than as operands to simulate at the decision point,
which is the same argument as the AST outline reader applied to semantics
instead of tokens.

---

## 2. Measured Baseline

Collected 2026-10-06 against commit `72ce53b`, target `cli/`, 260 non-spec
source files.

| Measure | Value |
| :--- | ---: |
| Total `if` statements | 2,731 |
| Compliant (named boolean, negation, or boolean-named predicate call) | 864 (32%) |
| Violating | 1,867 (68%) |
| Detected by the current rule | 87 (8% of violations) |

### 2.1 Violations by category

| Category | Count |
| :--- | ---: |
| Raw comparison (`if (ch === '\\')`) | 603 |
| Truthiness on a value (`if (quote)`) | 472 |
| Inline compound logic (`if (a \|\| b)`) | 451 |
| Verb-named call (`if (RE.test(line))`) | 194 |
| Truthiness on a property (`if (node.argument)`) | 147 |

### 2.2 Shape concentration

Reducing each violating test to its structural shape (subjects replaced with a
placeholder, literals reduced to kinds) yields 237 distinct shapes with heavy
concentration:

| Shape | Sites | Shape | Sites |
| :--- | ---: | :--- | ---: |
| `x` (truthiness) | 413 | `!fs.existsSync(p)` | 35 |
| `!x` | 249 | `!a \|\| !b` | 29 |
| `x === 'literal'` | 224 | `a && b` | 25 |
| `x.length > 0` | 85 | `x === 'lit' && y` | 24 |
| `fs.existsSync(p)` | 51 | `s.includes(...)` | 22 |
| `s.startsWith(...)` | 46 | `x === y` | 19 |
| `x >= NUM` | 40 | `x !== false` | 17 |
| `x === 0` | 39 | `typeof x === 'lit'` | 10 |
| `x.length === 0` | 38 | `x > NUM` | 10 |
| `x === 'a' \|\| x === 'b'` | 36 | | |

Cumulative coverage: top 10 shapes cover 64% of violations, top 20 cover 75%,
top 30 cover 80%, top 50 cover 86%.

Shape histogram computed over a 1,913-site superset using a marginally looser
compliance filter than the 1,867 headline. Percentages are unaffected.

### 2.3 Exact duplicate conditions

| Threshold | Distinct conditions | Call sites covered |
| :--- | ---: | ---: |
| 2 or more occurrences | 232 | 730 |
| 4 or more occurrences | 42 | 312 |

Highest-frequency duplicates:

```
81x  !db                      7x  score >= 90          5x  v.severity === 'CRITICAL'
20x  flags.isJson             7x  !filePath            5x  v.severity === 'HIGH'
16x  options.print !== false  6x  score >= 70          5x  v.severity === 'MEDIUM'
 8x  !dryRun                  6x  res?.status === 0    5x  lineCount >= 2000
 8x  !task                    6x  fs.existsSync(p)     5x  lineCount >= 1000
```

### 2.4 What already exists

`cli/audit/rules-predicates.js` (141 lines, 28 exports) already implements this
pattern: `isComponentPath`, `isCodeLine`, `isShallowCatchBody`,
`isGradeBelowMinimum`, `isSevereViolation`. Across the whole codebase there are
31 exported predicates and one name collision (`isSample`, defined twice).

Every existing predicate is a domain predicate. There are no structural
primitives: no `isEmpty`, no `isAbsent`, no `hasItems`. The domain layer was
built and the primitive layer was skipped, which is precisely why 1,088
structural checks remain inline.

---

## 3. The Three-Layer Lexicon

### 3.1 Layer 1: structural primitives

New module tree, `cli/lib/is/`. Subject-agnostic, finite, imports nothing.

```
is/value.js       isAbsent  isPresent  isZero  isPositive  isNotFound
is/collection.js  isEmpty  hasItems  hasExactly  contains
is/text.js        isNonEmptyString  startsWith  endsWith  matches
is/fs.js          pathExists  isMissing
is/type.js        isString  isNumber  isFunction  isPlainObject  isArray
```

Approximately 25 functions covering roughly 1,088 sites. This layer is complete
once written and does not grow, because structural shapes are finite.

**Every primitive must be a TypeScript type predicate, not a plain boolean.**
Without the `x is T` return form, narrowing is lost and `tsc` begins failing on
code that previously compiled:

```ts
export const isAbsent = <T>(x: T | null | undefined): x is null | undefined => x == null;
export const isNonEmptyString = (x: unknown): x is string =>
  typeof x === 'string' && x.length > 0;
```

This applies to generated capsules as well as the kit's own sources, so it is a
correctness requirement rather than a style preference.

### 3.2 Layer 2: domain vocabulary

Colocated with the subsystem it describes, following the existing
`rules-predicates.js` placement.

```
audit/grade-predicates.js   isGradeA  isGradeFailing  exceedsLineBudget
audit/rules-predicates.js   (exists, extend)
team/task-predicates.js     isClaimable  isBlocked  isComplete
```

Built from Layer 1. Gated by the Rule of Three already stated in AGENTS.md
section 1.A: a condition earns a domain name at 2 or more uses. Covers roughly
300 sites. Writing `isGradeA` once resolves the duplicated-threshold defect in
section 1.1.

### 3.3 Layer 3: decisions

Single-use composites, declared at the call site, not extracted. These compose
Layers 1 and 2 and contain no raw comparisons. Roughly 359 sites.

```js
// Stage 1: atomic concepts
const exceedsOperatorLimit = opCount > 2;
const hasMinimumOperators  = opCount >= 2;
const isCompoundClause     = hasMinimumOperators && hasBinaryClauses;
// Stage 2: decision
const isInlineBooleanHazard = exceedsOperatorLimit || isCompoundClause;
if (isInlineBooleanHazard) { }
```

### 3.4 The single enforcement rule

> A raw comparison may appear only inside a Layer 1 or Layer 2 predicate body.
> In every other position, conditions are composed from named predicates.

This is checkable from the AST in roughly 30 lines and expresses the entire
architecture in one sentence.

### 3.5 Why the lexicon cannot sprawl

Layer 1 is capped by the finite set of structural shapes. Layer 2 is capped by
the Rule of Three. Layer 3 is never extracted. Extracting all 1,867 conditions
into functions would produce the "indirection masquerading as modularity"
anti-pattern that AGENTS.md section 1.A already prohibits, so the reuse
threshold is load-bearing and must be enforced, not advisory.

---

## 4. Rules

Four rule IDs rather than one, so each carries its own severity, baseline, and
autofix tier.

| Rule ID | Fires on | Sites | Severity | Autofix |
| :--- | :--- | ---: | :--- | :--- |
| `CONTROL_FLOW_RAW_COMPARISON` | `if (x === y)`, `if (x >= n)` | 603 | MEDIUM | Tier A or C |
| `CONTROL_FLOW_IMPLICIT_TRUTHINESS` | `if (x)`, `if (obj.prop)` on non-booleans | 619 | MEDIUM | Tier A |
| `CONTROL_FLOW_INLINE_BOOLEAN` (rescoped) | `if (a \|\| b)`, compound logic | 451 | MEDIUM | Tier C |
| `CONTROL_FLOW_UNNAMED_PREDICATE` | `if (RE.test(s))`, verb-named calls | 194 | LOW | Tier A |

### 4.1 Compliance definition

A conditional test passes when it is one of:

- an identifier whose name matches the assertion-prefix pattern
  (`is`, `are`, `has`, `have`, `can`, `could`, `should`, `would`, `does`, `did`,
  `needs`, `must`, `allows`, `enables`, `contains`, `includes`, `supports`,
  `requires`, `exceeds`, `matches`, `wants`)
- the negation of such an identifier
- a call whose callee name matches the same pattern
- a member expression whose final property matches the same pattern

A call with a verb-named callee (`test`, `existsSync`, `includes`,
`startsWith`) does not pass: the `if` is still asking. This distinction accounts
for 194 sites. Treating all 335 call expressions as violations instead would
raise the total to 2,008; the narrower reading is taken because a callee already
named as an assertion has had its question named.

### 4.2 Name quality: reject restatements

The rule can be satisfied without producing any benefit:

```js
const isChEqualsBackslash = ch === '\\';     // passes, teaches nothing
const isCountGreaterThanFive = count > 5;    // passes, teaches nothing
```

This is the rule's central risk, and it is the failure mode a mechanical
transform produces by default. Without this check the outcome is 260 longer
files and no added clarity.

**Required behavior.** Tokenize the proposed name and tokenize the expression's
own vocabulary (identifier names, plus operator words: `equals`, `greater`,
`less`, `than`, `not`, `null`, `undefined`, `zero`, `true`, `false`). If the
name's tokens are a subset of that vocabulary, the name is a transliteration
and is rejected under `CONTROL_FLOW_RESTATEMENT_NAME`.

```js
const isChEqualsBackslash = ch === '\\';   // {ch, equals, backslash} subset  -> reject
const isEscapeChar        = ch === '\\';   // "escape" is a new domain term   -> accept
```

If a condition cannot be named in terms absent from the condition itself, it
has not yet been understood. That is a feature of the check, not a limitation.

### 4.3 Adjacency

A named boolean is declared on the statement immediately preceding its `if`.

**Exception.** When the binding is referenced 2 or more times within the
enclosing function, it may be hoisted to a position dominating first use. This
is mechanically checkable by counting references in the function scope.

Single-use bindings declared more than one statement from their conditional are
flagged. Without this, the rule produces a wall of `const is*` declarations at
function top whose meanings must be recalled 40 lines later, which is a
readability regression rather than an improvement.

### 4.4 Deferral to map dispatch

An `if` / `else if` chain of 3 or more branches testing the same subject does
not emit a boolean demand. It emits `CONTROL_FLOW_PREFER_MAP_DISPATCH`,
deferring to AGENTS.md section 3.E. Hoisting four branch conditions above a
chain forces the reader to scroll up to decode each branch, which is worse than
the inline form. A lookup table is the correct shape.

### 4.5 Additional checks

- Double negation (`if (!isNotFound)`) is flagged. Name the positive and negate
  at the point of use.
- A Stage-2 decision name is required only at 2 or more composed conditions. A
  single comparison has one stage and must not be given ceremonial wrapping.
- A numeric literal in a threshold comparison inside a Layer 2 predicate should
  be promoted to a named constant (`score >= GRADE_A_THRESHOLD`).

---

## 5. Autofix

`cli/audit/autofix.js` currently rewrites at the text level via
`fs.writeFileSync` of a modified string. `@babel/generator` is not a dependency
(only `parser`, `traverse`, and `types` are present). Text-level rewriting is
retained: it preserves formatting and comments, and adding a code generator
would reformat unrelated lines.

The three tiers overlap and do not sum to 1,867. A duplicated condition
may also be structural: `!db` appears 81 times and is handled by Tier A as
`isAbsent(db)`, so it is counted in both the duplicate census and the
structural total. The residual is the long tail of 237 distinct shapes below the
top 50, which carry 14% of sites.

### 5.1 Tier A: structural substitution

Replace a structural shape with its Layer 1 primitive. No naming decision is
required because the name is fixed by the shape.

| Before | After |
| :--- | :--- |
| `if (!db) return;` | `if (isAbsent(db)) return;` |
| `if (fixes.length > 0) {` | `if (hasItems(fixes)) {` |
| `if (history.length === 0) {` | `if (isEmpty(history)) {` |
| `if (!fs.existsSync(p)) {` | `if (isMissing(p)) {` |
| `if (idx === -1) return;` | `if (isNotFound(idx)) return;` |

Approximately 1,088 sites, zero naming decisions. Adds the required import.

### 5.2 Tier B: repeated domain conditions

For conditions appearing 2 or more times, extract one Layer 2 predicate and
replace every call site. One naming decision per concept rather than per site:
232 decisions covering 730 sites, or 42 decisions covering 312 sites if
restricted to the 4-or-more tier.

### 5.3 Tier C: report only

- `x === 'literal'` (224 sites). Mechanical naming here produces exactly the
  restatements rejected in section 4.2. The autofix proposes a name and an
  agent accepts or replaces it; it does not write unattended.
- Threshold comparisons against literals (`matchRatio >= 0.75`).
- Two-stage compositions and mixed-operator logic.
- Any site failing a safety gate in section 5.4.

### 5.4 Safety gates

A hoist or substitution is refused unless all four hold. These prevent
behavioral change, not style regressions.

1. The expression contains no call outside a known-pure allowlist.
2. The expression reads no binding that is reassigned between the insertion
   point and the conditional.
3. The conditional is not an `else if` whose expression is protected by a
   preceding branch. Hoisting `parsed.config.mode === 'strict'` above
   `if (!parsed) return;` throws at runtime.
4. Indentation is copied from the conditional's own source line.

Refused sites are reported with the gate that refused them.

---

## 6. Ratchet Baseline

Enabling these rules reports 1,867 violations immediately. Without a ratchet
the grade pins at F permanently and the score stops carrying information, which
is the same failure as the current state in the opposite direction.

**Required behavior.** Record per-rule counts in `chemx-ratchet.json` at the
project root, committed to version control. Not `.chemx/baseline.json`: `.chemx/`
is gitignored, so a ratchet there would not reach CI or other clones, and that
file already holds the health-score snapshot floor that `cli/audit/history.js`
rewrites automatically. A rule fails only when its count exceeds the recorded
baseline. New and modified code is held to the standard immediately; existing
debt is visible, non-blocking, and burns down as autofix passes run.
`chemx audit --rebaseline` re-records after a burn-down pass.

This also prevents the auto-triage disaster documented in the companion spec:
1,867 violations must never become 1,867 task rows.

---

## 7. Predicate Discovery

With roughly 250 predicates, agents will reinvent rather than reuse, producing
`isEmpty` beside `hasNoItems` beside `isBlank`. One collision already exists at
31 predicates, so this is a certainty rather than a risk.

The infrastructure exists: `cli/search-queries-similar.js` and
`chemx q --semantic` already perform vector similarity over indexed symbols.

**Required behavior.**

- Index predicates as a first-class symbol kind in `.chemx/index.db`.
- `chemx q --predicate "<concept>"` returns existing predicates ranked by
  semantic similarity, so an agent can check before writing.
- `chemx audit` emits `LEXICON_NEAR_DUPLICATE` when a newly added predicate is
  semantically adjacent to an existing one above a similarity threshold.
- The autofix Tier B extraction path queries the lexicon before creating a new
  predicate.

Without queryable discovery the lexicon degrades into synonyms and the rule's
benefit inverts. With it, the vocabulary becomes a searchable asset rather than
something agents must hold in context.

---

## 8. Directive Changes

| Location | Change |
| :--- | :--- |
| AGENTS.md 3.A | Restate from "decompose compound conditionals" to the section 1 standard. Current wording permits `if (x === y)`, which is why detection sits at 8%. |
| AGENTS.md 3.B | Add the reuse threshold (Layer 2 at 2 or more uses, Layer 3 below) and the lexicon module layout. |
| AGENTS.md (new) | Name quality: restatement rejection, assertion prefixes, adjacency. |
| AGENTS.md 3.E | Cross-reference from 4.4 as the correct shape for 3-or-more branch chains. |
| `rules-registry.js` | Add four rule IDs plus `CONTROL_FLOW_RESTATEMENT_NAME` and `LEXICON_NEAR_DUPLICATE`, each with baseline and autofix tier metadata. |

---

## 9. Acceptance Criteria

1. **Detection.** The rule set flags at least 95% of the 1,867 measured
   violations, verified against a committed fixture corpus extracted from the
   current `cli/` tree.
2. **Precision.** Zero violations reported against `cli/lib/is/` and the Layer 2
   predicate modules, which are the only legal homes for raw comparisons.
3. **Fixture pairs.** Every rule ships `should-fire.js` and `should-not-fire.js`.
   The should-not-fire files include the compliant forms from section 4.1.
4. **Restatement rejection.** A test asserts that transliterated names
   (`isChEqualsBackslash`, `isCountGreaterThanFive`) are rejected and that
   domain names (`isEscapeChar`, `exceedsHookBudget`) are accepted.
5. **Autofix safety.** A test corpus exercises all four section 5.4 gates and
   asserts refusal. A behavioral test confirms autofixed files produce identical
   results to their originals.
6. **Type narrowing.** `tsc --noEmit` passes on a TypeScript fixture that relies
   on narrowing through every Layer 1 primitive.
7. **Ratchet.** A test asserts that a count at baseline passes and a count one
   above baseline fails.
8. **Lexicon uniqueness.** A test asserts no two exported predicates exceed the
   semantic similarity threshold. The existing `isSample` collision is resolved.
9. **Self-clean.** `chemx audit cli` reports zero violations above baseline for
   all six new rules.

---

## 10. Sequencing

1. Layer 1 primitives with type predicates, plus unit tests. No rules enabled.
2. Rule implementations with fixture pairs, reporting only, ratchet recorded at
   current counts. Grade is unaffected.
3. Autofix Tier A against `cli/`, in reviewed batches by subsystem.
4. Layer 2 extraction for the 42 conditions at 4 or more occurrences, starting
   with the duplicated grade and line-count thresholds from section 1.1.
5. Predicate indexing and `chemx q --predicate`.
6. Directive rewrite in AGENTS.md, host shims regenerated.
7. Rebaseline; enable failing thresholds for new code.

Steps 1 and 2 are independent of the companion spec. Step 3 should not begin
until the companion spec's gate-coherence fix lands, otherwise autofix results
are validated by a `verify` that is not auditing the files being changed.

---

## 11. Risks

- **Compliance without insight.** The dominant risk. Mitigated by section 4.2;
  if restatement rejection is descoped, this specification loses most of its
  value and should be reconsidered rather than shipped partially.
- **Behavioral change from hoisting.** Mitigated by the section 5.4 gates and
  the behavioral equivalence test in criterion 5.
- **Lost type narrowing.** Mitigated by mandatory type predicates and
  criterion 6.
- **Lexicon synonym rot.** Mitigated by section 7.
- **Call-overhead in hot paths.** The character-scanning loops in
  `ai-slop-detector.js` and `extended-text-patterns.js` run per character.
  Primitive calls are trivially inlined by V8, but the audit's own runtime
  should be measured before and after Tier A to confirm.
- **Churn across 260 files.** Tier A touches most of the codebase. Batching by
  subsystem keeps diffs reviewable and bisectable.

---

## 12. Open Decisions

1. **Verb-named calls.** Section 4.1 treats `if (isCodeLine(x))` as compliant
   and `if (RE.test(s))` as violating, for 194 sites. Treating all call
   expressions as violating raises the total to 2,008.
2. **Truthiness naming floor.** For the 413 `if (x)` sites, autofix can apply
   `isPresent(x)` mechanically, but the domain name (`isInsideQuote`) is better.
   Confirm that the mechanical floor is acceptable as an intermediate state with
   domain naming applied opportunistically, rather than holding all 413 for
   manual naming.
3. **Scope.** This specification targets `cli/`. Generated capsule templates in
   `blueprints/` and `cli/generator-templates/` also emit conditionals, and
   holding generated output to the standard is a separate decision.
