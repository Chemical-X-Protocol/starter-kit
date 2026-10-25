# PHP and WordPress support in chemx audit: design spec (revision 2)

Date: 2026-10-24. Epic: #6429 (repo `apps/chemical-x/starter-kit`). Rollout target: epic #6116 (card vault security). Authority: the repository owner, 2026-10-23: "If we need to update our ChemX tool to support PHP better, we can do that too. It's part of the same project."

Revision 2 answers the precision, integration and breakdown reviews of 2026-10-24. Section 12, Critique log, maps every review issue to the change it caused or the reason it was rejected.

All paths are relative to the starter kit unless they start with `wp-content/` or `apps/`. Task status lives in `.chemx/index.db`; this document holds design only. Task keys (T2, T8b, ...) map to board ids in section 11.

## 1. Goal and non-goals

### Goal

1. `chemx audit`, `chemx check`, `--delta-base`, `verify --changed` and the `task done` gate audit `.php` files with a real parser instead of skipping them. Delta gates cover PHP when the command runs inside the repo that owns the PHP file (for a plugin submodule: cwd is the plugin). Pre-commit coverage needs a chemx hook in that repo; no plugin repo has one today (section 5.4).
2. A PHP file that the engine has not parsed is never reported as clean: `chemx audit`, `chemx check`, `task done` and the edit guardrails report it as inconclusive.
3. The audit finds the WordPress security bug classes that a manual review of the card vault plugin found. A rule ships on by default only when its labelled precision is 80% or better on both the corpus labels and a held-out set (section 2.6).
4. Existing structural rule ids apply to PHP with the same ids, so ratchets, triage and dashboards treat PHP like every other language.
5. `chemx read --outline` on PHP lists real declarations with real line ranges, and the search index stores PHP declarations instead of regex guesses.
6. Rolling PHP out does not flood the task board, does not turn existing ratchets red, and does not strand the in-flight #6116 tasks behind a gate change.

### Non-goals (this epic)

- Impact tracing over PHP (`--blast-radius`, `trace`, `backtrace`). Follow-up.
- Cross-file "undefined method" detection. Follow-up; it needs the namespace-aware index this epic builds.
- Template rules on inline HTML in PHP; PHPUnit fake-green patterns; secrets in `define()`; a WP Connectors credential rule; `@` error suppression. Follow-ups.
- Forge, `patterns`, `--clones` and `autofix` on PHP: `isForgeSource` (`cli/forge/file-units.js`) and `FIXABLE_EXTENSIONS` (`cli/audit/autofix.js`) keep excluding `.php`.
- Edit-time PHP parse checks (`cli/source-parse.js` `'php'` kind) and version-gated syntax findings. Follow-ups.
- Request-object taint sources for SECURITY_WP_UNSANITIZED_INPUT (`$request[...]`, `->get_param`). Follow-up after the fixes listed in section 4.
- Any change to code or config in `wp-content/plugins/*`, and installing chemx hooks in plugin repos. Both are owner decisions (section 13).
- New hand-written PHP directives in `AGENTS.md`.

## 2. Measured baseline

All numbers were measured on 2026-10-24 by read-only scripts in `/tmp/php-spike-scripts/` (u1 to u4, crit-precision, crit-integration, crit-breakdown) unless a row says otherwise. The plugin corpus is the 674 tracked PHP files of the 40 `xophz-compass*` plugins (133k lines, 4.9 MB) as of the u-spikes. The monorepo corpus is all 813 tracked PHP files. The third-party set is 13 git-ignored plugins on disk (6,740 files, `vendor/` excluded), read but never scanned by default.

### 2.1 Today's behavior

- `cli/languages.js` `LANGUAGE_DEFINITIONS` has no PHP entry. A `chemx audit` of the card vault plugin scans 2 files and skips all 25 PHP files (12,455 lines).
- `chemx check` on a PHP file returns `isClean: true` with 0 violations (`cli/audit-scan.js:46`). This is a false green.
- `chemx read --outline` on PHP uses the C++ regex fallback: precision 0.685, recall 0.841 over 3,976 declarations, every symbol at line 1.
- `chemx read --symbol` on PHP is right for 3,549 of 3,568 functions and methods (99.5%) through the text fallback.
- The index stores no PHP rows, so `chemx q <symbol>` finds nothing in PHP. `chemx q -g` works.

### 2.2 Parser spike (php-parser 3.7.0)

| Measurement | Value |
| :--- | :--- |
| Package | php-parser 3.7.0 (glayzzle), BSD-3-Clause, zero dependencies, 1.3 MB, pure JS, CommonJS, ships `types.d.ts`. Added to the kit in 17c172d (#6469). |
| Options used by the spike | `{ parser: { extractDoc: true, suppressErrors: false, version: '8.3' }, ast: { withPositions: true } }` |
| Plugin corpus, idle machine | 674 of 674 parsed, 0 errors, 4.2 s total, mean 6.3 ms, max 256 ms (`xophz-compass-diego-lawfirm/includes/class-diego-lawfirm-rpc.php`), heap 38 MB |
| Plugin corpus, load average 38 to 51 on 12 cores | 35.9 s wall to parse (crit-integration) |
| Card vault, cold process, same load | target file alone 1.3 to 2.5 s wall, 0.6 s CPU; all 26 PHP files 3.4 to 11 s wall, 2.0 to 3.1 s CPU |
| Monorepo corpus | 813 of 813 parsed, 0 errors, 15 s; slowest is the vendored minified `apps/lawfirm/DOCS/tools/adminer.php` at 1.4 s |
| `require` cost | 107 to 117 ms, once per process |
| Tree size | about 30 times the source size |
| Version support | with `version` set to 8.4 or 8.5 the parser accepts property hooks, asymmetric visibility, `new` without parentheses and the 8.5 pipe operator; with `'8.3'` these are parse errors (crit-integration/ver2.cjs) |
| Parse error shape | `SyntaxError` with `lineNumber`, `columnNumber`, message ending `on line N` |
| Comments | with `extractDoc: true`, `program.comments` lists every comment with kind and position |
| Namespaces | 0 of 674 corpus files declare a namespace; 4,202 of 6,740 (62%) third-party files do |

### 2.3 Text passes on PHP with no other change

Over the 674 plugin files: `AI_SLOP_ECHO_COMMENT` 83, `LINE_BUDGET_FILE` 56, `SYNTHETIC_MOCK_DATA` 1. Text constructs the line scanners misread: 105 lines where `?>` ends a `//` or `#` comment, 438 quoted strings spanning lines, 5 heredocs, 28 `#` comments.

### 2.4 Per-rule corpus counts, labelled precision and held-out evidence

Directive precision means the hit must change, or must carry a `chemx-allow` reason because it is intentionally exempt. Real-defect precision is given where measured. "Held-out" is evidence from code the prototypes were not tuned on: card vault HEAD after the 2026-10-24 #6116 commits, and the third-party set.

| Rule | Corpus hits | Corpus labels and precision | Held-out evidence (2026-10-24 review) |
| :--- | :--- | :--- | :--- |
| SECURITY_WP_PUBLIC_WRITE_ROUTE | 109 raw, 76 after guards | 22 labelled: directive 19/22 (86%); real holes 11/22 (50%). After the #6696 guard narrowing (2026-10-25): 25 labelled, directive 22/25 (88%), real holes 14/25 (56%) | third-party 12 of 13 kept hits false (4 of 5 after removing vendored copies); card vault HEAD 2 hits, both intentional |
| SECURITY_WP_REST_NO_PERMISSION_CALLBACK | 0 of 570 endpoints | not measurable | 89 of 89 hits false on the core controller shape (akismet, WooCommerce, Jetpack) |
| SECURITY_WP_PUBLIC_READ_SIDE_EFFECT | 5 to 8 | 5/8 (62.5%) | not measured |
| SECURITY_WP_UNPREPARED_SQL | 146 raw, 12 after classifier (u2); 20 at card vault HEAD | 8/12 (67%); 8/9 with the read-back guard | card vault HEAD: 8 new hits, 0 true; third-party: 156 hits, at least 82 false through 4 named mechanisms, so at most 47% |
| SECURITY_WP_UNESCAPED_OUTPUT | 124 after guards | 8/10 sample (80%) | not measured |
| SECURITY_WP_UNSANITIZED_INPUT, sink variant, superglobal sources | 24 raw, 9 | 8/9 (89%) | not measured |
| SECURITY_WP_UNSANITIZED_INPUT, sink variant, plus request-object sources | 120 in 32 files | at least 66 certain false, so at most 45% | card vault HEAD: 1 hit, false |
| SECURITY_WP_UNSANITIZED_INPUT, read-site variant | 533 reads, 38 | 3/10 (30%) | cut |
| SECURITY_WP_MISSING_NONCE | 32 handlers | 29/30 (97%) | third-party 18/23 (78%); 5 of 6 snapshot-backups hits false because the parent class in another namespace verifies the nonce |
| SECURITY_WP_SSRF, SECURITY_WP_OPEN_REDIRECT | 167 sinks, 8 | 8/8 | not measured |
| SECURITY_DYNAMIC_CODE_EXECUTION, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION | 11 raw, 2 | 2/2 after the request-taint guard | `assert` sub-rule: 20 of 20 third-party hits false (no string evaluation since PHP 8.0) |
| SECURITY_WP_CREDENTIAL_OPTION | 413 reads, 3 | 0/3 | cut |
| COMPLEXITY_CYCLOMATIC_HIGH (over 12) | 316 in 144 files | count 12/12; directive 10/12 (83%) | held up |
| CONTROL_FLOW_NESTED_TERNARY | 129 | 12/12 | held up |
| STRUCTURAL_WEIGHT_EXCEEDED (depth 4 or more) | 99 | 10/10 | held up |
| CONTROL_FLOW_CASCADE_GUARDS | 25 | 8/10 (80%); 15 unlabelled | 5 more labelled: 2 TP, 3 FP, so combined at most 10/15 (67%) |
| CONTROL_FLOW_SILENT_GUARD (PHP vocabulary) | 1 | 1/1, vocabulary tuned on the same hits | 2,604 third-party files: 15 hits, at least 11 false (about 4/15) |
| ERROR_SWALLOWED_EXCEPTION | 9 | 9/9 | not measured |
| AI_SLOP_SHALLOW_CATCH | 3 | 3/3 | not measured |
| UNGUARDED_LOGGING (refined) | 2 | 2/2, refinement tuned on the same hits | not measured |
| LINE_BUDGET_FILE | 56 | exact | exact |
| VIEW_MONOLITH (PHP `partials/`, `templates/`) | 4 | 4/4 | emitted at MEDIUM only (section 2.5) |
| AI_SLOP_ECHO_COMMENT | 83 | 7/12 (58%) | dropped for PHP |
| SYNTAX_PARSE_ERROR | 0 of 674 | n/a | n/a |

### 2.5 Gate impact, recomputed with `cli/audit/budget-rules.js` semantics

`checkLineBudgets` returns LINE_BUDGET_FILE first for any file over the file budget (`budget-rules.js:58-63`), and emits VIEW_MONOLITH as MEDIUM below 500 template lines and CRITICAL at 500 or more (`budget-rules.js:77-81`). A PHP partial over 500 lines therefore gets LINE_BUDGET_FILE MEDIUM, never VIEW_MONOLITH CRITICAL, so PHP views never block. The registry's VIEW_MONOLITH HIGH is never applied.

Structural blockers under the chosen plan (complexity, structural weight and nested ternary at MEDIUM for PHP):

| Blocking source | Plugin corpus | Card vault |
| :--- | :--- | :--- |
| LINE_BUDGET_FILE HIGH (1,000 lines or more) | 19 files (u3 counted 16 on the older tree) | 5: `includes/class-card-vault-api.php` 1,775; `includes/class-card-vault-catalog-rest.php` 1,014; `includes/class-card-vault-community.php` 1,008 at HEAD; `includes/class-card-vault-catalog-db.php` 1,057 and `includes/class-card-vault-catalog-importer.php` 1,046 in the working tree (uncommitted #6116 edits) |
| VIEW_MONOLITH | 0 | 0 |
| Complexity, structural weight, nested ternary | 0 (MEDIUM) | 0 |

Security HIGH and CRITICAL findings add files on top; T-preflip measures them at a pinned card vault commit. The draft's plan A (157 corpus files, 21 card vault) and plan B (85, 17) counted the partials as blocking and overstate.

Moving handlers into a new file is not a remedy: a target with no HEAD version counts every hazard as new at any severity (`cli/team/team-triage-verify.js:69-79`, `cli/audit/staged-delta.js:68`), and the moved handlers carry MEDIUM complexity findings (handle_scan_card cc 50, handle_auth_login 33, handle_license_checkout 27, handle_referral_summary 20).

### 2.6 Held-out set and the default-on bar

A rule ships on by default only when both hold:

1. Weighted precision on its corpus labels is 80% or better.
2. Weighted precision on its held-out labels is 80% or better, over at least 10 labelled held-out hits (or all hits when fewer exist).

The held-out set is fixed:

- H1: the card vault at its HEAD when the family task runs, exported read-only with `git -C wp-content/plugins/xophz-compass-card-vault archive <sha> | tar -x -C /tmp/cv-<sha>`; the sha is recorded in the task comment.
- H2: these git-ignored plugins on disk, read-only, `vendor/` excluded: akismet; woocommerce `includes/rest-api/Controllers/` and `src/Admin/API/`; snapshot-backups; wp-defender; forminator; hustle; wpmu-dev-seo; code-snippets; wp-hummingbird; wp-smush-pro.

Measurement scripts live in the task's own `/tmp` scratch directory and call the kit's pass modules directly; they never run `chemx audit` inside a plugin directory (which would create `.chemx/` and edit that plugin's `.gitignore`). Labels go in a task comment as `file:line TP|FP reason`. Each labelled hit is reduced to a minimal snippet with generic names (`demo_save`, `Demo_Client`) in the family's precision spec, with `origin` and `weight`.

## 3. Architecture

### 3.1 Language registration

`cli/languages.js` gains one entry in the existing schema:

```js
php: { id: 'php', name: 'PHP', extensions: new Set(['.php']), parser: 'php', commentPrefix: '//', blockComment: { start: '/*', end: '*/' } }
```

and one function, `getAstParser(filePath)`, returning `'babel'`, `'php'` or `null`. `isBabelParsable` keeps its meaning. Test detection has two sites and both learn the `Test.php` suffix: the inline check in `isSourceFile` (`languages.js:123-126`) and the local `isTestFile` in `cli/audit/extended-text-patterns.js:254-257`. Plugin-root `test-*.php` scripts stay source files.

`cli/audit-preflight-git.js` `isSourceFilePath` keeps its own list and adds only `.php`: `/\.(tsx|ts|jsx|js|vue|svelte|php)$/`. Switching it to `isSourceFile` would also add `.mjs`, `.cjs`, `.cs`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.c`, `.h` and `.cpp` to the hook, `--delta-base`, `verify --changed` and `audit --git`, which is a gate change for other languages outside this epic.

The registration (T16) is the switch that makes PHP live for every `isSourceFile` caller. It lands after every module it switches on is on `main` and tested through direct `auditCode` calls, and after the in-flight #6116 PHP-target tasks close (section 5.3).

Extensions: only `.php`.

### 3.2 Lazy parser loading

`cli/php/php-parse.js` follows `cli/babel-lazy.js`:

- `createRequire(import.meta.url)` loads `php-parser` on first use and keeps one Engine.
- Parse version: one constant, `PHP_PARSE_VERSION`, set to the newest version php-parser 3.7.0 accepts (8.5; T2's spec proves it with a property hook and a pipe expression, and falls back to 8.4 if 8.5 is refused). Analysis parses at that version so valid newer syntax never becomes SYNTAX_PARSE_ERROR CRITICAL. `.chemxrc` `php.version` (default `'8.3'`) is the deployment target; rules read it (the `assert` sub-rule, section 4). Version-gated syntax findings are a follow-up.
- A missing module never throws: `parsePhp` returns `{ unavailable: true }` and the analyzer records coverage `text-only`, reason `parser-unavailable`. The unavailable result is not memoized, so an install during a long-lived MCP process is picked up on the next call.
- A parse error returns `{ error: { line, column, message } }` with the trailing `on line N` trimmed.
- Minified or vendored files (over 64 KB and mean line length over 200) return `{ skipped: 'minified' }`.
- Trees are cached per process, keyed by content hash, in an LRU capped at 2 MB of source (about 60 MB of trees); files over 1 MB are not cached. A scan parses each file once; the cache serves the callee re-loads of the SQL helper binding. Cross-file facts are cached separately (section 3.8) and are small.
- `cli/php/php-walk.js` provides parent linking, `walk`, `scopeOf`, `walkScope` (does not enter nested functions or classes), and helpers for call names, literal values and line ranges.

### 3.3 Module layout

Engine code lives flat in `cli/php/`, one responsibility per file, each well under 500 lines. Specs sit next to them as `cli/php/*.spec.js` (the glob landed in 17c172d). Fixture modules and the pass test kit live in `cli/fixtures/php/`, which the published `files` field already excludes (`cli/fixtures/**`), so they never ship to npm. Fixtures are JS strings, never `.php` files on disk.

| File | Responsibility |
| :--- | :--- |
| `cli/php/php-parse.js` | lazy loader, parse, cache, minified check, `isPhpPath`, `PHP_PARSE_VERSION` |
| `cli/php/php-walk.js` | parent links, walk, scopes, call-name and literal helpers |
| `cli/php/php-comments.js` | comment regions and the file header range from `program.comments` |
| `cli/php/php-analyzer.js` | the PHP branch of the rule runner: parse, coverage, pass list, settings, finalize |
| `cli/php/php-metrics.js` | COMPLEXITY_CYCLOMATIC_HIGH, STRUCTURAL_WEIGHT_EXCEEDED |
| `cli/php/php-control-flow.js` | CONTROL_FLOW_NESTED_TERNARY, CONTROL_FLOW_CASCADE_GUARDS, CONTROL_FLOW_SILENT_GUARD |
| `cli/php/php-catch.js` | ERROR_SWALLOWED_EXCEPTION, AI_SLOP_SHALLOW_CATCH |
| `cli/php/php-logging.js` | UNGUARDED_LOGGING |
| `cli/php/php-taint.js` | request sources, sanitizers, flow-sensitive per-scope assignment index, value taint, URL host taint |
| `cli/php/php-dangerous.js` | SECURITY_DYNAMIC_CODE_EXECUTION, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION |
| `cli/php/wp-detect.js` | WordPress project detection |
| `cli/php/php-names.js` | namespace and `use` alias resolution to fully qualified names |
| `cli/php/php-facts.js` | per-file facts: classes, functions, calls, writes, auth and nonce checks, registrations |
| `cli/php/wp-project-index.js` | per-plugin index: file list, prefilter, on-demand facts, callable resolution, reachability, dependents |
| `cli/php/wp-rest-endpoints.js` | `register_rest_route` endpoint, method and permission resolution (core algorithm) |
| `cli/php/wp-route-rules.js` | SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK, SECURITY_WP_PUBLIC_READ_SIDE_EFFECT |
| `cli/php/wp-nonce.js` | SECURITY_WP_MISSING_NONCE |
| `cli/php/wp-sql.js` | SECURITY_WP_UNPREPARED_SQL |
| `cli/php/wp-request-flow.js` | SECURITY_WP_UNSANITIZED_INPUT, SECURITY_WP_SSRF, SECURITY_WP_OPEN_REDIRECT, parameter-to-sink summaries |
| `cli/php/wp-output.js` | SECURITY_WP_UNESCAPED_OUTPUT (default off) |
| `cli/php/php-symbols.js` | declarations with ranges, for outline and index |
| `cli/php/php-outline.js` | outline rendering |
| `cli/audit/inconclusive.js` | `isInconclusive(coverageRecord)` shared by check, guardrails and task done |
| `cli/fixtures/php/pass-context.js` | `buildPassContext(code, { path, config, index })` for unit specs |
| `cli/fixtures/php/*.fixtures.js` | one fixture module per rule family, `{ RULE_ID: { path, config, bad, good } }` |
| `cli/fixtures/php/index.js` | merges the family modules into `PHP_FIXTURES` |

The 11 new registry entries go inline in `cli/audit/rules-registry.js` (371 lines today, about 440 after). A separate `php-rules-registry.js` spread into `RULE_REGISTRY` is an import cycle with `PILLARS` (reproduced in crit-breakdown/cycle: `ReferenceError` in either import order).

Each rule family module also exports `RULE_DEFAULTS = { RULE_ID: { defaultOn, corpus: 'x/y', heldOut: 'x/y', measured: '2026-10-xx' } }`, set by its task from the section 2.6 measurement. T15b reads these to set `isDefaultOff` on new ids and to build the PHP default-off set for reused ids.

### 3.4 Pass interface

A PHP pass is `(ctx) => void`. `ctx` is:

```
{ ast, content, lines, filePath, relativePath, config, settings,
  phpTarget,                       // config.php.version or '8.3'
  wp: { isWordPress, root, kind } | null,
  index: ProjectIndex | null,
  crossFile: boolean,              // false in edit guardrails
  report(rule, nodeOrLine, hazard, extra) }
```

`config` is the full normalized config (`{ rules, overrides, wordpress, php, ... }`), not only the rules map. `report` records `{ rule, line, column, endLine?, tryBraceLine?, hazard, severity?, crossFile?, evidence? }`. `crossFile: true` with `evidence: 'path:line'` marks a finding whose cause lies in another file. Passes call `ctx.report('ID', ...)` only; no `rule: 'NEW_ID'` literals appear in `cli/` before T15b registers the ids (`cli/audit/rules-needs.spec.js` scans `rule:` literals). Registry directives cite only existing AGENTS.md headings (for example 9.D); `directive-refs.spec.js` checks this.

`php-analyzer.js` finalizes each record with `pillar`, `directive` and the default `severity` from the registry; a pass-supplied severity wins. Before T15b, finalize tolerates unregistered ids (the analyzer is dark). After T15b, a spec runs every PHP fixture and precision case and fails on any id missing from `RULE_REGISTRY`, and the registered-id scan in `rule-fixtures.spec.js` also matches `report\(\s*['"]([A-Z0-9_]+)`. At runtime an unregistered id is dropped and counted, never thrown.

Generic PHP passes run on every PHP file; WordPress passes run only when `ctx.wp.isWordPress`. A pass is skipped only when every rule it emits is off for this file per `resolveRuleSettings(relativePath, config)`, which includes `overrides` globs and default-off state.

### 3.5 Plugging into collectRawViolations and coverage

`auditCode` passes the full normalized config to `collectRawViolations` (today it passes `config.rules`, `rules.js:114`). `normalizeConfig` (`rules.js:23-26`) treats an object as a full config when it has any of `rules`, `overrides`, `wordpress` or `php`, so `{ wordpress: true }` is no longer misread as a bare rules map. The one fixture config shape is `{ rules: {}, overrides: [], wordpress: true }`.

`collectRawViolations` gets one branch before the Babel eligibility check:

1. Text passes run as today. For PHP, `AI_SLOP_ECHO_COMMENT` is dropped (58% precision).
2. With `--fast`, coverage is `text-only`, reason `fast`. Otherwise `analyzePhp` parses. A parse error pushes `SYNTAX_PARSE_ERROR` at the parser's position and records `parse-error`. Parser unavailable or minified records `text-only` with that reason. Otherwise the passes run and coverage is `ast`. When the per-plugin index hit its cap, coverage carries reason `wp-index-capped` with kind `ast`.
3. PHP never reaches `parseScriptAsts`, `runAstPasses`, `runTailwindUnscannedPass` or the SFC passes.
4. `hasHighComplexity` and `checkLineBudgets` run as today. `cli/audit/line-budgets.js` adds `.php` to the view markup check only under `partials/` and `templates/`.
5. `auditCode` passes PHP comment regions and the header range to `applyAuditPostFilters`.

Coverage is returned, not only collected. A new `auditCodeDetailed(content, filePath, relativePath, options)` returns `{ violations, coverage }`, where coverage is `{ kind, language, reason }` for that file; `auditCode` keeps its signature and return value. `auditFileDetailed` in `cli/audit-scan.js` wraps it. `cli/audit/coverage.js` records `language` and `reason` per file and adds `byLanguage` to `summarizeCoverage` (`{ php: { files, ast, textOnly, parseErrors } }`); `summarizeCoverageForCard` in `audit-summary.js` and `cli/audit/status-file.js:47` carry `byLanguage` through.

Inconclusive results: `isInconclusive(coverage)` is true when the file's language has an AST parser and the coverage kind is not `ast`. Then `chemx check` prints "inconclusive: <reason>" and is not clean; `evaluateGuardrails` reports the edit as not verified; and `verifyFromAudit` in `task done` refuses with reason `inconclusive-coverage`.

### 3.6 Comments and suppression

- PHP comment regions come from `program.comments`, not `cli/audit/comment-regions.js`.
- `applyAuditPostFilters(raw, lines, { commentRegions, fileHeaderEndLine })` (`cli/audit/suppressions.js:123`) accepts precomputed regions. JS callers pass nothing and behave exactly as today; `cli/audit/precision.spec.js` (35 chemx-allow cases) proves it.
- Annotation forms on PHP: `// chemx-allow: RULE reason`, `# chemx-allow: RULE reason`, `/* chemx-allow: RULE reason */`. A PHP 8 attribute `#[...]` is not a comment.
- File-level findings sit on line 1. An annotation in the file's leading comment block also applies to line-1 findings, for any language that reports a header range (only PHP in this epic).
- Catch findings carry `endLine` and `tryBraceLine`; for the second and later catches of one `try`, `tryBraceLine` is the closing brace line of the previous catch.

### 3.7 WordPress project detection and config

`.chemxrc` keys. `cli/config/index.js` `loadProjectConfig` exposes them as top-level fields (today they stay under `raw`, `config/index.js:70-79`):

| Key | Values | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `wordpress` | `"auto"`, `true`, `false` | `"auto"` | `false` turns every WordPress pass off; `true` treats every PHP file as WordPress |
| `php.version` | a PHP version string | `"8.3"` | the deployment target that version-sensitive rules read; parsing always uses `PHP_PARSE_VERSION` |

Auto detection, per file, nearest directory wins: walk from the file's directory up to the scan root and stop at the first directory that holds a top-level `*.php` whose first 8 KB matches `^[ \t/*#@]*Plugin Name:` (plugin), a `style.css` with `Theme Name:` (theme), or `wp-config.php` / `wp-includes/version.php` (core, applies only under its `wp-content/`). A path segment `/wp-content/(plugins|mu-plugins|themes)/<name>/` also marks `<name>` as the root. Only content-only audits fall back to AST signals (`add_action`, `add_filter`, `register_rest_route`, `$wpdb`, `WP_REST_Request`, an `ABSPATH` guard).

Caches are keyed by the mtimes of the files they read: detection by the header file and `style.css`; the audit config cache in `cli/audit-scan.js:30-39` by the `.chemxrc` mtime. A long-lived MCP server therefore sees `.chemxrc` changes and new plugin headers without a reconnect.

Measured: the header check detects 40 of 40 plugin directories and the plugin nested in `apps/glowitheflow/wordpress-plugin`, and rejects `apps/lawfirm`.

### 3.8 Per-plugin project index

Missing-nonce, route and request-flow rules need callbacks in other classes and files. `wp-project-index.js` provides them without a pre-pass in `cli/audit-scan.js`, and without parsing the whole plugin on gate paths.

- File list: `listGitFiles(root)` (tracked and untracked, `-co`, the same listing discovery uses) filtered by the same `hasIgnoredSegment` rule as `discoverSourceFiles` (so `vendor/` at any depth is out). Outside git: a walk skipping `vendor/` and `node_modules/`. The list is re-read when the root's git index mtime changes or after 30 seconds, so a file created during an MCP session becomes visible.
- Two levels. Level 1 is a text prefilter over every listed file: read the bytes, record `namespace`, declared class, interface and trait names, and whether the file contains `register_rest_route`, `add_action`, `add_filter`, `wp_ajax_` or `admin_post_`. No parse. Level 2 parses a file and extracts facts only when a rule needs it: registration-bearing files, and files that declare a class a resolution step reaches.
- Facts (from `php-facts.js`, plain data, no trees): classes with fully qualified name, `extends` and traits; functions and methods with ranges, parameters, calls (receiver kinds `func`, `this`, `self`, `static`, `parent`, `static-class`, `var-new`), state writes, outbound requests, auth checks, nonce checks, `returnsTrueOnly`; registrations (`register_rest_route` endpoints, `add_action` and loader `->add_action` hooks, `wp_ajax_*` and `admin_post_*` map entries).
- Names: `php-names.js` resolves every class reference (`extends`, `implements`, traits, `new`, static calls, `X::class`, string callables) against the file's namespace and `use` imports, following PHP's rules for unqualified, qualified and fully qualified names. Facts store fully qualified names.
- Callable resolution handles `'fn'`, `'C::m'`, `['C','m']`, `[$this,'m']`, `[self::class,'m']`, `array(__CLASS__,'m')`, `__CLASS__ . '::m'`, `X::class . '::m'`, closures, `$x = new C` in the same function and `$this->prop = new C`, through `extends` chains and traits.
- `reaches(ref, predicate, { hops: 2 })` follows calls, cycle-safe. `dependentsOf(relativePath)` returns the files whose registrations or calls resolve into the given file (reverse edges), for the gate (section 5.3).
- Invalidation per file by size and mtime. The audited file is overlaid with the content passed to `auditCode`, so the HEAD re-audit in `task done` sees HEAD content for the target.
- Caps: 400 files or 8 MB of source per root. Above the cap the index holds only the audited file and coverage carries reason `wp-index-capped`.
- Edit guardrails (`patch`, `write`) audit with `crossFile: false`: WordPress passes run on the audited file alone and report no cross-file findings.

Results for one file can depend on other files of the same plugin. Section 5.3 states how the gates handle that.

### 3.9 Finding anchors

A finding sits in the file that must change:

- SECURITY_WP_PUBLIC_WRITE_ROUTE: the `permission_callback` entry line in the registering file.
- SECURITY_WP_REST_NO_PERMISSION_CALLBACK: the endpoint array line.
- SECURITY_WP_PUBLIC_READ_SIDE_EFFECT: the `callback` entry line; `evidence` names the side effect.
- SECURITY_WP_MISSING_NONCE: the callback's declaration line; `evidence` names the registration.
- Sink rules: the sink line. A one-hop flow across files is anchored at the call site that passes the request value; `evidence` names the sink.

Every finding whose evidence is in another file sets `crossFile: true`.

## 4. Rules

"Shipped" is the default with no `.chemxrc` setting. Default-off for a new id is the registry field `isDefaultOff: true`; for a reused id that is off only for PHP, the analyzer passes a PHP default-off set to the settings resolver. Both are honored by `cli/audit/rule-overrides.js` when no setting names the rule. A new setting value `"on"` (or `true`) enables a default-off rule and keeps the engine's per-violation severities; a severity value (`"low"` to `"critical"`) enables it and overwrites every severity, as today (`rule-overrides.js:20-25, 73`).

Conditional defaults are decided by the family task from section 2.6 and recorded in its `RULE_DEFAULTS`. The "Shipped" column gives the rule and the expected outcome.

| Rule id | Reused or new | Severity | Needs | Pillar / category | Detection summary | Corpus hits | Labelled precision | Shipped |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| SECURITY_WP_PUBLIC_WRITE_ROUTE | new | MEDIUM | standard | 9 Security | Endpoint with POST, PUT, PATCH or DELETE and a public permission (`'__return_true'`, a closure or arrow fn returning only `true`, or a resolvable callable whose body is only `return true`) whose resolved callback reaches a state write or an outbound request within 2 hops (the READ_SIDE_EFFECT predicate). Guard: no auth-like call (`current_user_can`, `is_user_logged_in`, `wp_verify_nonce`, `hash_equals`, `wp_check_password`, `wp_signon`, `get_current_user_id`, or a method matching `/verify\|validat\|auth\|signature\|token\|guard\|permission\|can_\|handle_registration/`) within 2 hops. Since #6696 a method named `verify_<noun>` or `validate_<noun>` for business data (payment, order, cart, email, url, fields and similar) is not auth-like, and an auth-like call whose value only becomes data (a ternary branch, the right side of `??` or an array value, on its way to an assignment or statement) does not count; a call that reaches a test or a return still counts. Callbacks whose only write is `wp_logout` are exempt. | 76 before the write predicate | headline real holes 11/22 (50%); directive 19/22 (86%); 14/25 and 22/25 after #6696 | conditional on directive precision with the held-out set; expected on at MEDIUM |
| SECURITY_WP_REST_NO_PERMISSION_CALLBACK | new | HIGH | standard | 9 Security | WordPress core's algorithm (`wp-includes/rest-api.php`): drop top-level `args` as common args; treat the array as a single endpoint only when `callback` is set; otherwise iterate numeric keys only (skipping `schema` and other non-numeric keys); fire on an endpoint with no `permission_callback`. | 0 | definitional; the 89 held-out false hits are the core controller shape, which becomes the good fixture | on, if the held-out run on akismet and WooCommerce shows 0 hits |
| SECURITY_WP_PUBLIC_READ_SIDE_EFFECT | new | HIGH | standard | 9 Security | Public endpoint with no write verb whose callback reaches, within 2 hops, `dbDelta`, option or meta writes, `wp_insert_*`/`wp_update_*`/`wp_delete_*`, file writes, `wp_remote_*`, `download_url`, `wp_mail`, user creation, auth cookies, scheduling or `$wpdb` writes. | 8 | 5/8 (62.5%) | off |
| SECURITY_WP_UNPREPARED_SQL | new | HIGH; CRITICAL when the unsafe value is request-derived | standard | 9 Security | `$wpdb` (or `$this->wpdb`, `$this->db`) read and query methods whose SQL is not `->prepare()` and contains an unsafe value; `prepare()` whose query string interpolates an unsafe value; `esc_like()` without `prepare`; LIKE wildcards from unsafe values. Classifier as in u2 plus: values read back through `$wpdb` are safe; private or static helper parameters are safe when every call site in the index passes a safe value; `list()` and `[...]` destructuring classify the right-hand call's returns; a class property with a literal default assigned only from literals or constants is safe; `call_user_func(_array)` with `[$wpdb,'prepare']` counts as prepare; a strict `in_array` allowlist in a dominating `if` makes the value safe; `array_keys` of a literal map, through `array_filter` and `array_values`, is safe; table names from resolvable `*table*` helpers that read a literal map are safe. | 20 at card vault HEAD | 8/9 on the u2 labels; held-out at most 47% before the fixes | conditional; expected off for ruleset 7 |
| SECURITY_WP_UNESCAPED_OUTPUT | new | MEDIUM; HIGH when request-derived | standard | 9 Security | `echo`, `<?=`, `print` of a value that is not a literal, constant, numeric cast or escaper result, with the u2 guards. | 124 | 8/10 sample | off |
| SECURITY_WP_UNSANITIZED_INPUT | new (sink variant, superglobal sources only) | HIGH | standard | 9 Security | A superglobal value (`$_GET`, `$_POST`, `$_REQUEST`, `$_COOKIE`, `$_SERVER` HTTP_*, REQUEST_URI, QUERY_STRING, PHP_SELF) reaches `echo`, a `$wpdb` query outside `->prepare()` arguments, an option or meta value argument, `wp_insert_post`/`wp_update_post` content, `header`, `setcookie`, `file_put_contents`, `unserialize`, `extract`, `call_user_func` or `include` in the same function with no sanitizer between, using the flow-sensitive scope index. Object-id arguments of meta writes and `ID` keys are not sinks. | 9 | 8/9 (89%) | conditional on held-out; expected on |
| SECURITY_WP_MISSING_NONCE | new | HIGH | standard | 9 Security | A `wp_ajax_*` or `admin_post_*` handler that reaches a state write within 2 hops and no nonce check (`check_admin_referer`, `check_ajax_referer`, `wp_verify_nonce`, or a function or method matching `/nonce\|referer\|csrf\|sanity_check/`) within 2 hops, resolved through namespaces, `extends` and traits. | 32 | 29/30 (97%); held-out 18/23 before namespace resolution | conditional on held-out with namespaces; expected on |
| SECURITY_WP_SSRF | new | HIGH | standard | 9 Security | A request-controlled URL host reaches `wp_remote_get`/`post`/`request`/`head`, `download_url`, `file_get_contents`, `fopen`, `curl_init`, `media_sideload_image` or `getimagesize`, directly or through one call. Killed by `wp_http_validate_url`. `wp_safe_remote_*` are not sinks. | 8 (with redirect) | 8/8 | conditional on held-out; expected on |
| SECURITY_WP_OPEN_REDIRECT | new | MEDIUM | standard | 9 Security | A request-controlled URL host reaches `wp_redirect`. Killed by `wp_validate_redirect`; `wp_safe_redirect` is not a sink. | see SSRF | 8/8 | conditional on held-out; expected on |
| SECURITY_DYNAMIC_CODE_EXECUTION | reused | CRITICAL | standard | 9 Security | `eval`; `create_function`; `preg_replace` with an `e` modifier; `assert` with a string literal or encapsed argument only when `php.version` is below 8.0. | 2 combined | 2/2 | on |
| SECURITY_PHP_OBJECT_INJECTION | new | HIGH | standard | 9 Security | `unserialize` without an `allowed_classes` option; `maybe_unserialize` only when request-derived. | see above | see above | on |
| SECURITY_PHP_COMMAND_EXECUTION | new | CRITICAL | standard | 9 Security | `shell_exec`, `exec`, `system`, `passthru`, `proc_open`, `popen`, `pcntl_exec`, backtick shell strings. | see above | see above | on |
| SECURITY_WP_CREDENTIAL_OPTION | proposed | n/a | n/a | n/a | Literal credential keys in `get_option` calls. | 3 | 0/3 | cut |
| COMPLEXITY_CYCLOMATIC_HIGH | reused | MEDIUM for PHP | standard | 2 Control flow | Per function, method, closure and arrow fn: 1 plus if, elseif, ternary (including `?:`), case with a test, match arm conditions, `&&`, `\|\|`, `and`, `or`, `??`, for, foreach, while, do-while, catch; over `maxCyclomaticComplexity` (12). | 316 | 10/12 (83%) | on |
| STRUCTURAL_WEIGHT_EXCEEDED | reused | MEDIUM for PHP | standard | 1 Line budgets | Braced control nesting depth 4 or more per function; elseif adds none; nested functions excluded. | 99 | 10/10 | on |
| CONTROL_FLOW_NESTED_TERNARY | reused | MEDIUM for PHP | light | 2 Control flow | Outermost ternary of a nested chain; pure `?:` chains exempt. | 129 | 12/12 | on |
| CONTROL_FLOW_CASCADE_GUARDS | reused | LOW (registry, `rules-registry.js:145-150`) | standard | as registered | 3 or more if-without-else guards ending in `throw` or bare `return;`, then an action. Exempt: a guard whose test reads only the variable assigned by the statement just before it (load-then-check); guard blocks of more than 3 statements that end in `return` (mode branches). | 25 | at most 10/15 (67%) before the exemptions | conditional on all 25 labelled plus held-out; PHP-off if under 80% |
| CONTROL_FLOW_SILENT_GUARD | reused | registry | standard | as registered | Bare `return;` under an error-ish test in a mutation-named function. Reporting calls that make a guard non-silent: `wp_send_json_error`, `wp_die`, `status_header`, `error_log`, `add_settings_error`, `add_action`, redirect calls, and any method matching `/log\|warn\|error\|notice\|report/i`. Exempt: `add_action`/`add_filter` callbacks whose guard tests `is_wp_error()` or `->get_error_*()` on an argument WordPress passed in. Error words match whole identifiers, never text inside array-key strings. | 1 | about 4/15 held-out | PHP-off for ruleset 7 |
| ERROR_SWALLOWED_EXCEPTION | reused | registry | standard | as registered | Catch that is empty or comment-only, or has no throw, call, `new`, echo, exit, return with a value, or assignment other than to the catch variable. | 9 | 9/9 | on |
| AI_SLOP_SHALLOW_CATCH | reused | registry | standard | as registered | Catch body is one `error_log`, `trigger_error`, `var_dump`, `print_r`, `var_export`, `dump` or `dd` call. | 3 | 3/3 | on |
| UNGUARDED_LOGGING | reused | registry (LOW) | light | 7 Global hygiene | Dump functions; `print_r`/`var_export` without `true`; `error_log` only when unguarded by `WP_DEBUG`, outside catch and error-ish branches, without error wording. | 2 | 2/2 (tuned on the same hits) | on (LOW, non-blocking); held-out labels recorded by T5 |
| LINE_BUDGET_FILE | reused | registry (500 MEDIUM, 1,000 HIGH, 2,000 CRITICAL) | standard | 1 Line budgets | Unchanged. | 56 | exact | on |
| VIEW_MONOLITH | reused | MEDIUM below 500 lines as emitted by `budget-rules.js`; files over 500 lines get LINE_BUDGET_FILE first | standard | 1 Line budgets | `.php` under `partials/` or `templates/` over 200 lines. | 4 | 4/4 | on |
| SYNTAX_PARSE_ERROR | reused | registry (CRITICAL) | standard | 1 Line budgets | php-parser error at its position, parsed at `PHP_PARSE_VERSION`. | 0 | n/a | on |
| SYNTHETIC_MOCK_DATA and the other text passes | reused | registry | as registered | as registered | Unchanged. | 1 | borderline | on |
| AI_SLOP_ECHO_COMMENT | reused | registry | as registered | as registered | Text pass; fires on PHP section banners and SQL text. | 83 | 7/12 (58%) | off for `.php` (dropped by the PHP branch) |
| SECURITY_WP_UNSANITIZED_INPUT read-site variant | proposed | n/a | n/a | n/a | Every superglobal read. | 38 | 3/10 | cut |

Summary of defaults. Ship off: SECURITY_WP_PUBLIC_READ_SIDE_EFFECT, SECURITY_WP_UNESCAPED_OUTPUT, CONTROL_FLOW_SILENT_GUARD for PHP, AI_SLOP_ECHO_COMMENT for PHP, and any conditional rule under the bar (SECURITY_WP_UNPREPARED_SQL is expected here). Cut: SECURITY_WP_CREDENTIAL_OPTION and the read-site input variant. The `assert` sub-rule is dropped for PHP 8 targets.

Per-violation severity for PHP (complexity, structural weight, nested ternary at MEDIUM) uses the same mechanism as `TIMER_DISCIPLINE`. At MEDIUM, a count rise still blocks `task done` through the per-rule delta.

## 5. Gates and ratchets

### 5.1 Ruleset 7

`RULESET_VERSION` goes from 6 to 7. Revision 7 is recorded only for the 11 new ids (SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK, SECURITY_WP_PUBLIC_READ_SIDE_EFFECT, SECURITY_WP_UNPREPARED_SQL, SECURITY_WP_UNESCAPED_OUTPUT, SECURITY_WP_UNSANITIZED_INPUT, SECURITY_WP_MISSING_NONCE, SECURITY_WP_SSRF, SECURITY_WP_OPEN_REDIRECT, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION). Existing rules keep their revisions: what changes for them is the set of files they see, which the language-aware ratchet handles. `rule-revisions.spec.js` gains the ruleset 7 snapshot.

### 5.2 Ratchets

- Language-aware adoption (`cli/audit/ratchet.js`): each ratchet scope records the file extensions it scanned (`languages`). A baseline with no `languages` field is read as the extensions `isSourceFile` accepted at ruleset 6, which excludes `.php`. `compareToBaseline` adopts, rather than gates, the counts from violations whose file extension is not in the recorded set, and records the new set. JS regressions in consumers keep being gated, and a consumer's first PHP scan adopts PHP counts once.
- The kit's `chemx-ratchet.json` has ruleset 6 and 52 revisions in scopes `.` and `cli`; the `cli` scope holds `CONTROL_FLOW_INLINE_BOOLEAN: 804` (the draft wrongly said all counts were 0). `cli/audit/ratchet-upgrade.spec.js:82-89` requires the committed file to record the current ruleset and every registry id. T15b runs `chemx verify` before the bump, bumps, lets the run rewrite the file to ruleset 7 with 63 revisions and the `languages` set in both scopes, confirms the counts are unchanged, and commits the file in the same commit.
- None of the 40 plugins has a ratchet or a `.chemxrc`, so no plugin ratchet turns red.

### 5.3 The task-done gate and deltas

- `task done` re-audits the target at HEAD and compares rule counts (`staged-delta.js:65-71`, `gate-delta.js:51-65`). An unchanged PHP file is neutral.
- The absolute filter refuses a target with any CRITICAL or HIGH finding (`team-triage-verify.js:74-80`). Findings marked `crossFile: true` are exempt from the absolute filter and are gated by delta only, because their cause may lie in a file the task did not touch.
- Cross-file regressions: when the target is a PHP file in a WordPress root, `task done` also re-audits each file in `index.dependentsOf(target)` at disk and at HEAD and refuses when any rule count rises there. The index uses HEAD content for the target only; pinning the whole plugin at HEAD is a follow-up if the dependents check proves too weak.
- `task done` refuses with `inconclusive-coverage` when the target's PHP coverage is not `ast` (section 3.5).
- After T16, tasks that target a PHP file of 1,000 lines or more cannot pass the gate. For the card vault that is the 5 files in section 2.5. Moving handlers into a new file does not help (section 2.5). The remedy is a split task per such file under #6116 that runs first and leaves each moved method at cc 12 or below or annotated with a `chemx-allow` reason. Filing those tasks edits work in another app, so the orchestrator proposes them to the owner and does not file them unasked.
- T16 does not land while any open #6116 task (in progress, queued or blocked) has a `.php` target. T-preflip lists them from the live board (on 2026-10-24: #6439, #6441, #6444, #6446, #6447, #6448, #6450 in progress; #6442, #6443, #6445 queued), posts a decision naming them, and waits with `chemx team task wait`-style `chemx wait --task=<id>` for each.

### 5.4 Delta gates and hooks

- `staged-delta` and `base-delta` run `git diff` in cwd without recursing into submodules (`staged-delta.js:44`, `base-delta.js:18`). From the monorepo root they see a plugin only as a gitlink, so PHP delta gating applies only with cwd inside the plugin repo.
- Only the kit has a chemx pre-commit hook. No `.git/modules/wp-content/plugins/*/hooks/pre-commit` exists, and the root hook (yorkie) exits 0. `chemx commit` on a plugin path relies on that plugin's hook (`commit-run.js:121-124`). PHP pre-commit coverage therefore needs `chemx hook` installed in each plugin repo, which is an owner decision (section 13).
- `audit-preflight-git.js` adds only `.php` (section 3.1).

### 5.5 Audit grades and root scans

- Health and AI-slop scores fall when PHP files count (card vault: 2 scanned files to 27 or more). `status-file` records `ruleset`, so trend views mark the break at ruleset 7.
- Plugin-level `chemx verify` turns red for plugins with CRITICAL or HIGH PHP findings. The monorepo root verify narrows to `src/` (`verify.js:90`) and is unaffected.
- Root `chemx audit` and the MCP audit do not narrow today (`cmd-audit.js:86`, `tools-audit.js`), and `listGitFiles` recurses into submodules, so a root audit would parse 814 PHP files (7.04 MB, 39 s at load). T-root-scope makes both pass `narrowWorkspaceRoot: true` when no explicit dir is given, the same as verify; `--dir=.` keeps the full scan. This changes the root JS audit scope too, and is recorded in the changelog.

### 5.6 Rolling out without a triage flood

- Triage is opt-in (`--triage` or `autoTriage: true`, #5480), capped at `TRIAGE_RUN_CAP` (50) per run. No plugin and not the monorepo root sets `autoTriage`.
- Severity does not reduce volume: triage files one child per (rule, file) plus one parent per rule spanning more than one file (`team-triage-generate.js:84-153`). Structural findings alone on the card vault give about 44 tasks (complexity 18 files, line budget 10, structural weight 5, nested ternary 3, cascade 2, swallowed 1, plus 5 parents); security findings and the new JS under `admin/js/card-vault-admin/` add more. Expect one full capped run of 50.
- T18 runs `--triage` exactly once, by the orchestrator, on the live card vault after the #6116 PHP-target tasks are closed (so `hasOpenTask` cannot miss hand-filed tasks that lack a `rule_id`). Triage parents stay top-level, because `findOrCreateParent` matches only `parent_id IS NULL` (`team-triage-generate.js:115`) and re-parenting would make a later run duplicate them. Their ids are listed in a comment on #6116. A second run, and triage of any other plugin, is an owner decision.

## 6. Search and outline

Needed now, because triage tasks carry line numbers that agents map to methods through the outline, and index rows feed triage `tier` and `health_score`:

- `php-symbols.js`: one walker yielding `{ name, container, kind, visibility, isStatic, isAbstract, startLine, endLine, signature }` for namespaces, classes, interfaces, traits, enums, functions, methods, properties and constants; on a parse error it retries with `suppressErrors: true` for a partial result.
- `php-outline.js` renders ranges on member lines (`L14-1775  class Card_Vault_API`, `  L24-256  public function register_routes()`). `cli/reader.js` (434 lines) only adds a dispatch to it ahead of the polyglot branch, a few lines, so it stays under its line budget.
- `--logic` on PHP prints "logic skeleton not available for PHP; use --outline or --symbol".
- `cli/search-ast.js` `extractAstMetadata` gets a `.php` branch on `php-symbols.js`; `.php` is excluded from the regex fallback. Methods are indexed under their own name with `Class::method` in the signature. No `INDEX_VERSION` bump: no PHP rows exist yet.
- `cli/search-scan.js`: an explicit `--dir` keeps git-ignored files only when the named directory is wholly ignored. Landed in 2033c9c (#6482).

Follow-ups: `--symbol` through the PHP tree with `Class::method`; a `container` column and `INDEX_VERSION` 3; PHP edges for `--blast-radius` and `backtrace`; PHP callee extraction for `trace`; a `wp_registrations` table; WordPress tier mapping; `trace` printing `Defined in: <target>:1` for unknown targets.

## 7. Performance budget

Budgets are CPU time (`process.cpuUsage`, or `%U + %S` from `/usr/bin/time`) because wall time on this machine swings with a load average of 38 to 51. Measured basis: parser load 107 to 117 ms; idle parse mean 6.3 ms, max 256 ms; card vault cold parse of all 26 files 2.0 to 3.1 s CPU; target file alone 0.6 s CPU cold.

| Scope | Budget (PHP-added CPU) |
| :--- | :--- |
| Scans with no PHP | 0: the parser is never loaded |
| One file, warm, non-minified, up to 2,000 lines | parse plus all passes at most 400 ms; corpus mean at most 30 ms |
| Single-file gate path, cold process (`chemx check` or the `task done` re-audit on one card vault file) | at most 1,500 ms, of which the project index (prefilter plus on-demand parses) at most 1,000 ms |
| Edit guardrails on one PHP file (`patch`, `write`; `crossFile: false`) | at most 600 ms per evaluation, cold |
| One plugin, cold (card vault, 26 PHP files) | at most 4,000 ms |
| Plugin corpus (674 files) in one process | at most 25 s for parse plus all passes; peak heap growth at most 400 MB |
| Memory | parse cache 2 MB of source (about 60 MB of trees); the index keeps facts, not trees |
| Minified or vendored files | not parsed |

Every taint and assignment lookup uses a per-scope index built in one pass; no rule rescans a scope per use (the prototype's 34 s outlier came from a quadratic scan). If the cold gate path misses its budget, a facts cache on disk keyed by content hash (extractFactsCached in cli/php/php-facts.js, in a per-user temp dir, off with CHEMX_PHP_FACTS_CACHE=off) cuts a repeat run to roughly 130 ms CPU on the card vault single-file case. The 1,000 ms single-file budget is only measured to hold with a warm cache: a cache miss costs about the same as no cache (900 to 1,350 ms CPU at load average about 10 on 4 parsed files), and a fresh machine or a changed analyzer source starts cold. The 16-file hops-2 case of #6476 was not reproduced. Budgets are checked by T8b (gate path), T-preflip (corpus and plugin, before the flip) and T18 (after), never inside `node --test`.

## 8. Testing

All specs use `node --test`, run as `chemx test <spec>` from the kit with the global `chemx` (the kit's `node_modules/.bin/chemx` points at a stale `file:.` snapshot without `cli/php`). Code fixtures are minimal snippets with generic names; no realistic names, emails or seed data.

### 8.1 Fixture pairs

Every new rule id and every reused id that PHP emits has a PHP `{ path, config, bad, good }` pair in a family module under `cli/fixtures/php/`, merged into `PHP_FIXTURES` by `cli/fixtures/php/index.js`. `cli/audit/rule-fixtures.spec.js` treats a rule as covered when it is in `FIXTURES` or `PHP_FIXTURES`, runs every PHP pair through `auditCode` (bad fires, good is clean under every rule, `rule-fixtures.spec.js:130-137`), checks that each default-off rule's bad fixture is silent without config and fires with `"on"`, and its registered-id scan also matches `report\(\s*['"]([A-Z0-9_]+)` in `cli/php/*.js`. Before T15b, each family task runs its good fixtures through every pass already on `main` with `buildPassContext`, so cross-family conflicts surface in the family task. WordPress good fixtures sanitize request values (`sanitize_text_field( wp_unslash( ... ) )`). WordPress fixtures use the path `wp-content/plugins/demo/demo.php` and config `{ rules: {}, overrides: [], wordpress: true }`.

### 8.2 Unit and integration specs

- `php-parse.spec.js`, `php-walk.spec.js`, `php-analyzer.spec.js`, `php-comments.spec.js`, `wp-detect.spec.js`, `php-names.spec.js`, `php-facts.spec.js`, `wp-project-index.spec.js` (temp git repo with an ignored folder, a tracked `vendor/`, and an untracked new file).
- Suppression: PHP cases in `cli/php/php-comments.spec.js` and an end-to-end case in `rule-fixtures.spec.js`; JS behavior pinned by the existing `cli/audit/precision.spec.js`.
- Config: `cli/config/config.spec.js` (a temp-dir `.chemxrc` with `wordpress: false` and `php.version` reaches `ctx` through `auditFile`); `cli/audit/rule-overrides-default-off.spec.js` (default-off, `"on"` keeps engine severities, a severity overwrites, an `overrides` glob enables a default-off rule).
- Ratchet: `cli/audit/ratchet-languages.spec.js`; the existing `ratchet-upgrade.spec.js` after T15b.
- Gates: `cli/team/team-done-delta.spec.js` (unchanged PHP target neutral; added hazard refused; inconclusive coverage refused; the two-file cross-file scenario), `cli/audit/inconclusive.spec.js` (parser stubbed unavailable: check not clean, guardrails not verified).
- Language and discovery: `cli/languages.spec.js`, `cli/audit-preflight.spec.js`, `cli/audit-scan-php.spec.js`, `cli/audit-scope.spec.js`.
- Outline and search: `cli/reader-php.spec.js`, `cli/search-php.spec.js`.

### 8.3 Precision regression specs

One per family. Each case is a minimal snippet reproducing one labelled hit shape, tagged `TP` or `FP`, with `origin` (corpus or held-out `file:line`) and `weight` (the number of labelled hits it stands for; weights sum to the labelled count). Every TP must fire, every guarded FP must stay silent, and known FPs that still fire are tagged `known: 'FP'`. The spec computes weighted precision separately for corpus and held-out cases and fails a default-on rule under 80% on either. The review's held-out false positives (section 12) are seeded as FP cases in the matching family spec.

### 8.4 Per-task acceptance and the full suite

Per task: its named specs through `chemx test <spec>`, plus `chemx check <each changed file>`. No per-task full `chemx verify`: on this machine it did not finish within 10 minutes under 6 concurrent runs (#6469, #6482). Full `chemx verify` runs twice, serialized, after `chemx wait --verify-idle`: in T15b (ruleset bump) and in T16 (flip, on a clean tree).

## 9. Docs

- `README.md`: a PHP row in the language table and a Tier 2 bullet; the Python, Go and Rust rows corrected to "universal text passes"; the triage paragraph corrected to opt-in.
- New `docs/php-wordpress.md`: parse version and deployment target, config keys, detection, the rule table with shipped defaults, `"on"` and how to enable default-off rules, annotation forms, the per-plugin index, its caps and cross-file results, coverage reasons and inconclusive results, the gate rules of section 5.3, delta gating only inside the plugin repo, performance numbers, and that Forge, `patterns` and `autofix` do not cover PHP; that `create_function` and `/e` only appear in code that does not run on PHP 8.
- `docs/audit-gates.md`: PHP added to the preflight list, PHP MEDIUM severities, cross-file delta-only findings, dependents re-audit, inconclusive refusal.
- `docs/INDEX.md`: link the new page.
- `docs/CHANGELOG.md`: ruleset 7 entry naming the 11 new ids, the language-aware ratchet, the `"on"` setting, the root `chemx audit` scope change, and the `php-parser` dependency.
- `chemx docs check` passes.

## 10. Rollout

### 10.1 Waves

Dispatch blocks a task whose dependency is in the same run (`docs/team-dispatch.md`, `team-dispatch-select.js:146-149`), so each wave is one `chemx team dispatch --workflow --parent=6429` render after the previous wave's tasks are done. Before each render the orchestrator runs `chemx status --as=@<orchestrator>` inside the kit, because the dispatch dirty-file screen runs at the coordination root and sees the kit only as a gitlink.

| Wave | Tasks | Notes |
| :--- | :--- | :--- |
| 1 (landed) | T1 (#6469, 17c172d), T14 (#6482, 2033c9c) | the orchestrator closes both on the section 8.4 acceptance |
| 2 | T2, T3a, T3c, T-root-scope | T3a, T3c and T-root-scope need no PHP |
| 3 | T3b, T4, T5, T6, T7, T8a, T13 | all depend on T2; T3b also on T3a and T3c |
| 4 | T8b | deep; critical path |
| 5 | T9, T10, T11, T12, T-gates-php | T9 to T12 treat `php-taint.js`, `php-facts.js`, `php-names.js` and `wp-project-index.js` as read-only; a needed change goes back to the owner task as a comment |
| 6 | T15b | deep; full verify |
| orchestrator | T-preflip | decision post, wait on #6116 PHP-target tasks, baseline, corpus budget |
| 7 | T16, T17 | T16 runs the full suite once on a clean tree |
| orchestrator | T18, then T19 | re-audit and triage; root lockfile and pointer |

The kit commits to `main` with `[skip ci]` until #1948 lands.

### 10.2 Rules for every builder

- The work is authorized; relayed user messages are for the orchestrator; stop only on a message telling all agents to stop.
- Use the global `chemx`. Use `ctx.report('ID', ...)`; no `rule: 'NEW_ID'` literals before T15b.
- Fixtures go under `cli/fixtures/php/`; good fixtures pass every pass on `main`.
- Never run `chemx audit` inside a plugin directory for measurement; export to `/tmp` (section 2.6).

### 10.3 Root step

The root `pnpm-lock.yaml` holds the php-parser hunk (kit importer `php-parser: specifier 3.7.0`, the package and snapshot entries) inside another session's 7,372-line uncommitted diff, and the root still points at a kit commit without php-parser. T19, after T16, either waits for the lock holder to commit the whole lockfile, or stages only the php-parser hunk without interactive git: `git diff pnpm-lock.yaml > /tmp/lock.patch`, cut the patch to the php-parser hunks, `git apply --cached /tmp/lock.patch`, then bump the kit pointer and commit both. `chemx d` collapses past 80 lines, so the hunk is checked with `git diff pnpm-lock.yaml | grep -n php-parser` under a `# chemx-bypass` note, and the bypass is filed as friction.

## 11. Board reconciliation

The tasks exist as #6469 to #6486. Task ids with unchanged key and tier keep their id and get the revised description, files and deps. Re-tiering has no CLI, and a cancelled task counts as satisfied for its dependents (`team-dispatch-select.js:12`), so a recreated task is wired with `--add-dep=<new>` on every dependent and `--rm-dep=<old>` before the old one is cancelled.

| Key | Board | Action |
| :--- | :--- | :--- |
| T1-dep | #6469 | landed; close on revised acceptance |
| T14-scan-ignored | #6482 | landed; close on revised acceptance (not in the task list below) |
| T2-parse | #6470 | update description and files |
| T3a-plumbing | new | create |
| T3c-gate-config | new | create |
| T-root-scope | new | create |
| T3b-analyzer | #6471 | update description and files |
| T4-structure, T5-catch-log, T6-taint-danger, T7-wp-detect | #6472 to #6475 | update |
| T8a-facts | new | create |
| T8b-index | #6476 | update (stays deep) |
| T9 to T12 | #6477 to #6480 | update |
| T13-outline | #6481 | update |
| T-gates-php | new | create |
| T15b-registry | new (deep) | create; move dependents; cancel #6483 |
| T-preflip | new | create, orchestrator-run |
| T16-language-flip | #6484 | update deps |
| T17-docs | #6485 | update deps |
| T18-reaudit | new (standard) | create, orchestrator-run; cancel #6486 |
| T19-root-bump | new | create, orchestrator-run |

The orchestrator also files "Friction: dispatch dirty screen blind to submodule-internal files" and "Friction: chemx d collapses a large lockfile diff so a single hunk cannot be inspected".

### Board ids (filled in by the orchestrator, 2026-10-24)

| Key | Task |
| :--- | :--- |
| T1-dep | #6469 |
| T2-parse | #6470 |
| T3b-analyzer | #6471 |
| T4-structure | #6472 |
| T5-catch-log | #6473 |
| T6-taint-danger | #6474 |
| T7-wp-detect | #6475 |
| T8b-index | #6476 |
| T9-wp-routes | #6477 |
| T10-wp-nonce | #6478 |
| T11-wp-sql | #6479 |
| T12-wp-flow | #6480 |
| T13-outline | #6481 |
| T16-language-flip | #6484 |
| T17-docs | #6485 |
| T3a-plumbing | #6510 |
| T3c-gate-config | #6511 |
| T-root-scope | #6513 |
| T8a-facts | #6514 |
| T-gates-php | #6515 |
| T15b-registry | #6516 |
| T-preflip | #6517 |
| T18-reaudit | #6518 |
| T19-root-bump | #6519 |
| T14-scan-ignored | #6482 (done, 2033c9c) |

T1-dep #6469 is done (17c172d). #6483 and #6486 are closed as duplicates of T15b-registry and T18-reaudit. Orchestrator steps T-preflip, T18-reaudit and T19-root-bump are claimed by the orchestrator so dispatch never selects them. Revised scopes for kept ids are posted as task comments that supersede the original descriptions.

## 12. Critique log

### Precision review

- P1 (blocker, SQL): accepted. The classifier gains the six mechanisms the review named (call-site parameter binding, destructuring, literal-default properties, `call_user_func` prepare, dominating `in_array` allowlists, `array_keys` of literal maps) and resolvable table helpers reading literal maps. The rule is gated on the section 2.6 held-out set, with the 8 card vault HEAD shapes and the 4 third-party mechanisms seeded as FP cases. Severity drops to HIGH, CRITICAL when request-derived. Expected default for ruleset 7: off.
- P2 (input sources): accepted, option (a). v1 uses superglobal sources only, which is what 8/9 measured. `->prepare()` arguments and object-id arguments are excluded as sinks anyway; request-object sources are a follow-up.
- P3 (REST no-permission shape): accepted. Section 4 and T9 pin core's algorithm; the akismet and WooCommerce shapes are the good fixture and FP cases.
- P4 (namespaces): accepted. New `php-names.js` and task T8a; facts store fully qualified names; nonce gets a namespaced fixture and the snapshot-backups held-out run; the nonce vocabulary adds `sanity_check`.
- P5 (public write route): accepted. Fires only when the callback reaches a write or outbound request; string-concatenation callables; auth guard 2 hops deep; `wp_logout`-only exempt; real-hole precision is the headline. Severity lowered to MEDIUM so intentional public routes do not block `task done`.
- P6 (silent guard): accepted. Vocabulary widened as proposed, and the rule ships off for PHP in ruleset 7.
- P7 (held-out methodology): accepted. Section 2.6 defines the held-out set and the two-sided bar; precision specs carry held-out cases and weights; corpus figures are dated.
- P8 (`assert`): accepted. Dropped for PHP 8 targets; literal or encapsed arguments only for older targets; docs note `create_function` and `/e`.
- P9 (cascade guards): accepted. All 25 hits labelled in T4, two exemptions added, severity corrected to LOW, PHP-off if under the bar.

### Integration review

- I1 (gate impact, blocker): accepted. Section 2.5 recomputed with `budget-rules.js` semantics; the "new file" remedy withdrawn; T16 waits on every open #6116 PHP-target task, not only in-progress ones; split tasks proposed to the owner. The config-switch alternative (`php.gate false` in the card vault) is rejected because it edits another app's config.
- I2 (config reach): accepted. Full config to `collectRawViolations` and `normalizeConfig` change in T3b; `loadProjectConfig` exposure in T3c; one fixture config shape; pass skipping through `resolveRuleSettings` with `overrides`.
- I3 (severity flattening): accepted. `"on"` setting in T3c; fixtures use it.
- I4 (pre-commit): accepted. Goal 1 no longer claims pre-commit coverage; delta gating stated as plugin-cwd only; hook install is an open question; preflight adds `.php` only.
- I5 (never clean if not parsed): accepted. `auditCodeDetailed` returns coverage; check, guardrails and `task done` report inconclusive (T3a, T-gates-php).
- I6 (per-task verify): accepted. Section 8.4.
- I7 (cross-file anchors): accepted. `crossFile` findings are delta-only for the absolute filter, and `task done` re-audits dependents. Staged deltas still see only the staged file; this is documented.
- I8 (performance): accepted. CPU budgets including cold gate paths; text prefilter and on-demand parsing instead of a whole-plugin parse; guardrails run without cross-file passes; root audit narrowing (T-root-scope). The 2 MB parse cache is kept: a scan parses each file once, so cache size does not drive scan cost.
- I9 (triage volume and re-parenting): accepted. Estimate corrected; no re-parenting; one orchestrator-run triage after the #6116 PHP tasks close. A triage `--parent` flag is left as a follow-up.
- I10 (moving target for T18): accepted. T18 audits a pinned pre-fix export and a HEAD export, records both shas, and triages the live tree once.
- I11 (ratchet adoption): accepted. Revisions bump only for new ids; language-aware adoption in `ratchet.js`; `chemx-ratchet.json` committed in T15b.
- I12 (MCP caches): accepted. Unavailable not memoized; index file list re-read on git index mtime or 30 s; detection and config caches keyed on mtimes.
- I13 (lockfile): accepted. T19 with a non-interactive hunk-only procedure; global chemx required.
- I14 (registered-id scan): accepted. `report(` regex and the id assertion spec in T15b.
- I15 (language entry shape and test detection): accepted. Section 3.1.
- I16 (parse version): accepted. Parse at `PHP_PARSE_VERSION`; `php.version` is the deployment target; version-gated findings are a follow-up.
- I17 (index vs discovery file list): accepted. `listGitFiles` plus `hasIgnoredSegment`.
- I18 (packaging, Forge, byLanguage, plugin side effects): accepted. Fixtures and the test kit move to `cli/fixtures/php/`; Forge and autofix listed in non-goals; `byLanguage` carried through the card and status file; measurement uses `/tmp` exports.

### Breakdown review

- B1 (ratchet file, blocker): accepted. T15b owns `chemx-ratchet.json`; section 5.2 corrected.
- B2 (import cycle): accepted, option (c): entries inline in `rules-registry.js`.
- B3 (dispatch waves): accepted. Section 10.1, 7 renders including the landed wave; T17 depends on T15b and T-gates-php, not T16; T18 is orchestrator-run.
- B4 (per-task verify): accepted, as I6.
- B5 (T5 acceptance): accepted. T5 tests suppression through `applyAuditPostFilters` only where `php-comments.js` exists; the end-to-end case moves to T15b.
- B6 (fixture conflicts): accepted. T15b owns all fixture modules; family tasks run good fixtures through every pass on `main`; WP good fixtures sanitize.
- B7 (config): accepted, as I2; `cli/config/config.spec.js` is the spec.
- B8 (registered-id scans): accepted, as I14 plus the builder rule.
- B9 (T16 shape, preflight width, spec files): accepted.
- B10 (missing tasks): accepted. T19 (root), T-preflip (decision, wait, baseline, corpus budget).
- B11 (task size and tier): accepted. T3 split into T3a, T3c and T3b; T15 split into T3c (defaults, `"on"`) and T15b (deep); T8 split into T8a and T8b; `reader.js` only dispatches; the recreate procedure is in section 11.
- B12 (weights): accepted. Section 8.3.
- B13 (VIEW_MONOLITH): accepted. Tested through `checkLineBudgets`; counts corrected.
- B14 (dirty screen): accepted. Orchestrator check before each render and a friction task.
- B15 (T18 tier and target): accepted. Standard, orchestrator-run, single triage, timings against T-preflip.
- B16 (non-checkable acceptance): accepted. Thresholds: at least 1,700 of 1,753 non-namespaced sites resolved; outline precision and recall at least 0.98 with `/tmp/php-spike-scripts/u4/outline-compare.mjs` and `symbol-compare.mjs`; stored descriptions cite board ids.
- B17 (spec file names, shared helpers): accepted. Real spec names used; the taint additions moved into T6.

### Brief deviation

The brief asked for 10 to 18 tasks. The reviews required three splits and two missing steps, so the list has 24: 1 close-out of landed work, 4 orchestrator-run steps, and 19 dispatched builds. Dispatch renders fall from 9 to 7 despite the higher count.

## 13. Open decisions for the owner

Listed in the run's open questions: per-language PHP severities, PUBLIC_WRITE_ROUTE at MEDIUM, split tasks for the 5 card vault files over 1,000 lines, root audit narrowing, chemx hooks in plugin repos, enabling default-off rules in the card vault config, and the follow-up list.
