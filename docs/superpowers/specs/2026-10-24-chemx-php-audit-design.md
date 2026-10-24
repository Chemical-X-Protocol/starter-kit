# PHP and WordPress support in chemx audit: design spec

Date: 2026-10-24. Epic: #6429 (repo `apps/chemical-x/starter-kit`). Rollout target: epic #6116 (card vault security). Authority: the repository owner, 2026-10-23: "If we need to update our ChemX tool to support PHP better, we can do that too. It's part of the same project."

All paths are relative to the starter kit unless they start with `wp-content/` or `apps/`. Task status lives in `.chemx/index.db`; this document holds design only.

## 1. Goal and non-goals

### Goal

1. `chemx audit`, `chemx check`, the pre-commit hook, `--delta-base`, `verify --changed` and the `task done` gate audit `.php` files with a real parser instead of skipping them.
2. A PHP file that the engine has not parsed is never reported as clean.
3. The audit finds the WordPress security bug classes that a manual review of the card vault plugin found, at a labelled precision of 80% or better for every rule that ships on by default.
4. Existing structural rule ids (complexity, nesting, ternaries, guards, catches, logging, line budgets) apply to PHP with the same ids, so ratchets, triage and dashboards treat PHP like every other language.
5. `chemx read --outline` on PHP lists real declarations with real line ranges, and the search index stores PHP declarations instead of regex guesses.
6. Rolling PHP out does not flood the task board and does not turn existing ratchets red.

### Non-goals (this epic)

- Impact tracing over PHP (`--blast-radius`, `trace`, `backtrace` across `include` and class references). Follow-up.
- Cross-file "undefined method" detection. The spikes found 2 real cases and 1 dangling REST callback; the rule needs trait resolution first. Follow-up.
- Template rules (image alt, tabnabbing, `javascript:` URLs) on inline HTML in PHP. Follow-up.
- PHPUnit fake-green patterns, secrets in `define()` and class constants, a WP Connectors credential rule, `@` error suppression. Follow-ups.
- Edit-time PHP parse checks in `patch` and `write` (`cli/source-parse.js` `'php'` kind). Follow-up.
- Any change to code in `wp-content/plugins/*`. This epic changes the kit only; the card vault is audited, not edited.
- New hand-written PHP directives in `AGENTS.md`.

## 2. Measured baseline

All numbers were measured on 2026-10-24 by read-only scripts in `/tmp/php-spike-scripts/` unless a row says otherwise. The plugin corpus is the 674 tracked PHP files of the 40 `xophz-compass*` plugins (133k lines, 4.9 MB). The monorepo corpus is all 813 tracked PHP files.

### 2.1 Today's behavior

- `cli/languages.js` `LANGUAGE_DEFINITIONS` has no PHP entry. A `chemx audit` of the card vault plugin scans 2 files and skips all 25 PHP files (12,455 lines).
- `chemx check` on a PHP file returns `isClean: true` with 0 violations, because `auditFile` returns `[]` for non-source files (`cli/audit-scan.js:46`). This is a false green.
- `chemx read --outline` on PHP uses the C++ regex fallback: precision 0.685, recall 0.841 over 3,976 declarations, every symbol at line 1. It lists invented symbols such as `function varchar` (from SQL text) and `function array`.
- `chemx read --symbol` on PHP is right for 3,549 of 3,568 functions and methods (99.5%) through the text fallback.
- The index stores no PHP rows, so `chemx q <symbol>` finds nothing in PHP. `chemx q -g` works.

### 2.2 Parser spike (php-parser 3.7.0)

| Measurement | Value |
| :--- | :--- |
| Package | php-parser 3.7.0 (glayzzle), BSD-3-Clause, zero dependencies, 1.3 MB, pure JS, CommonJS, ships `types.d.ts` |
| Options | `{ parser: { extractDoc: true, suppressErrors: false, version: '8.3' }, ast: { withPositions: true } }` |
| Plugin corpus | 674 of 674 files parsed, 0 errors, 4.2 s total, mean 6.3 ms, max 256 ms (`xophz-compass-diego-lawfirm/includes/class-diego-lawfirm-rpc.php`), heap 38 MB |
| Monorepo corpus | 813 of 813 files parsed, 0 errors, 15 s total; slowest is a vendored minified `apps/lawfirm/DOCS/tools/adminer.php` (313 KB in 816 lines) at 1.4 s |
| `require` cost | 107 to 117 ms, once per process |
| Tree size | about 30 times the source size (`apps/lawfirm/app/api/index.php`: 255 KB source, 7.5 MB tree) |
| Parse error shape | `SyntaxError` with `lineNumber`, `columnNumber`, message `Parse Error : syntax error, unexpected '{' ... on line N` |
| Comments | with `extractDoc: true`, `program.comments` lists every comment with kind and position |

### 2.3 Text passes on PHP if `.php` were registered with no other change

Over the 674 plugin files (u3): `AI_SLOP_ECHO_COMMENT` 83, `LINE_BUDGET_FILE` 56 (40 MEDIUM, 12 HIGH, 4 CRITICAL), `SYNTHETIC_MOCK_DATA` 1. Over the 813 monorepo files (u1): 212 violations (140 echo comment, 70 line budget, 2 mock data), 5 CRITICAL and 19 HIGH. Text constructs the line scanners misread: 105 lines where `?>` ends a `//` or `#` comment, 438 quoted strings spanning lines, 5 heredocs, 28 `#` comments.

### 2.4 Per-rule corpus counts and labelled precision

Precision is "the hit matches the rule's directive": the code must change, or it must carry a `chemx-allow` reason because it is intentionally exempt. Where the reports also measured "real defect" precision, both are given.

| Rule | Corpus hits (raw to after guards) | Labelled | Precision |
| :--- | :--- | :--- | :--- |
| SECURITY_WP_PUBLIC_WRITE_ROUTE | 109 to 76 | 22 after guards: 11 real holes, 8 intentionally public, 2 auth inside the callback missed by the guard, 1 no-op | 19/22 (86%) directive; 11/22 (50%) real holes |
| SECURITY_WP_REST_NO_PERMISSION_CALLBACK | 0 of 570 endpoints | none possible | not measurable; definitional |
| SECURITY_WP_PUBLIC_READ_SIDE_EFFECT | 5 (one hop, same file) to 8 (two hops, cross file) | 8 | 5/8 (62.5%) |
| SECURITY_WP_UNPREPARED_SQL | 146 to 12 | 12 | 8/12 (67%); 8/9 (89%) when values read back from the database count as safe |
| SECURITY_WP_UNESCAPED_OUTPUT | 158 to 124 in 27 files | 15 sampled; 10 after guards | 8/15 (53%) raw; 8/10 (80%) after guards |
| SECURITY_WP_UNSANITIZED_INPUT (sink variant) | 24 to 9 | 9 | 8/9 (89%) |
| SECURITY_WP_UNSANITIZED_INPUT (read-site variant) | 533 reads to 38 | 10 sampled | 3/10 (30%) |
| SECURITY_WP_MISSING_NONCE | 32 handlers | 30 | 29/30 (97%) |
| SECURITY_WP_SSRF and SECURITY_WP_OPEN_REDIRECT | 167 sink calls to 8 (one hop) | 8 | 8/8 (100%) |
| SECURITY_DYNAMIC_CODE_EXECUTION, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION | 11 to 2 | 11 | 2/11 raw; 2/2 (100%) after the request-taint guard on `maybe_unserialize` |
| SECURITY_WP_CREDENTIAL_OPTION | 413 reads to 3 | 3 | 0/3 (0%) |
| COMPLEXITY_CYCLOMATIC_HIGH (over 12) | 316 in 144 files, 30 plugins | 12 | count correct 12/12; directive 10/12 (83%) |
| CONTROL_FLOW_NESTED_TERNARY | 135 to 129 (6 pure `?:` chains exempt) | 12 | 12/12 (100%) |
| STRUCTURAL_WEIGHT_EXCEEDED (depth 4 or more) | 99 in 66 files (83 also fire complexity) | 10 | 10/10 (100%) |
| CONTROL_FLOW_CASCADE_GUARDS | 25 in 15 files | 10 | 8/10 (80%) |
| CONTROL_FLOW_SILENT_GUARD (PHP vocabulary) | 5 to 1 | 12 candidates | 1/1 after vocabulary; the 4 removed were all FP |
| ERROR_SWALLOWED_EXCEPTION | 9 in 8 files | 9 | 9/9 (2 real swallows, 7 need a `best-effort` reason) |
| AI_SLOP_SHALLOW_CATCH | 3 | 3 | 3/3 |
| UNGUARDED_LOGGING (refined) | 20 naive to 2 | 20 | 2/20 naive; 2/2 refined |
| LINE_BUDGET_FILE | 56 (40 MEDIUM, 12 HIGH, 4 CRITICAL) | all | exact |
| VIEW_MONOLITH (PHP `partials/`, `templates/`) | 4 | 4 | 4/4 |
| AI_SLOP_ECHO_COMMENT | 83 in 39 files | 12 | 7/12 (58%) |
| SYNTHETIC_MOCK_DATA | 1 | 1 | 1 borderline |
| SYNTAX_PARSE_ERROR | 0 of 674 | n/a | n/a |

Sources: u2 report (security rules), u3 report (structural rules), u1 and u4 reports (engine and outline). Scripts and hit lists: `/tmp/php-spike-scripts/u1/` to `u4/`.

### 2.5 Gate impact (computed 2026-10-24 from `/tmp/php-spike-scripts/u3/out/recs.jsonl`)

Files on the plugin corpus that would carry at least one structural HIGH or CRITICAL finding, and so block `task done` for any task targeting them:

| Severity plan | Corpus files | Card vault files (of 25) |
| :--- | :--- | :--- |
| A: registry severities as they are (complexity HIGH, structural weight HIGH) | 157 | 21 |
| B: complexity HIGH only above 24, structural weight HIGH only at depth 5 or more | 85 | 17 |
| C (chosen): complexity, structural weight and nested ternary emit MEDIUM for PHP; line budget and view budget unchanged | 20 (16 files of 1,000 lines or more, 4 large partials) | 5 |

Under plan C the 5 card vault files are `includes/class-card-vault-api.php` (1,775 lines), `includes/class-card-vault-catalog-rest.php` (1,014 lines) and three `admin/partials/*-display.php` files. Security findings add files on top; their final count is measured in the re-audit task.

## 3. Architecture

### 3.1 Language registration

`cli/languages.js` gains one entry:

```js
php: { extensions: ['.php'], parser: 'php', commentPrefix: '//', lineComments: ['//', '#'], blockComment: ['/*', '*/'] }
```

and one function, `getAstParser(filePath)`, returning `'babel'`, `'php'` or `null`. `isBabelParsable` keeps its meaning. `isTestFile` also recognizes the `Test.php` suffix. Plugin-root `test-*.php` scripts stay source files: the corpus shows they are debug scripts that ship.

`cli/audit-preflight-git.js` `isSourceFilePath` stops keeping its own JS-only extension list and calls `isSourceFile` from `languages.js`. Without this, PHP hazards would skip the pre-commit hook, `--delta-base` and `verify --changed`.

The registration is the switch that makes PHP live for every `isSourceFile` caller (audit discovery, search scan, index admission, edit guardrails, task tier, staged and base deltas). It lands in one task, after every module it switches on is already on `main` and tested through direct `auditCode` calls. Before that task, `auditCode(content, 'x.php', ...)` already runs the PHP branch (specs use it), while real scans still skip PHP because discovery asks `isSourceFile`.

Extensions: only `.php`. The monorepo has no `.phtml` or `.inc` files.

### 3.2 Lazy parser loading

`cli/php/php-parse.js` follows `cli/babel-lazy.js` and `cli/sfc/sfc-parse.js`:

- `createRequire(import.meta.url)` loads `php-parser` on first use and keeps one Engine per PHP version.
- A missing module (a running MCP server started before the install, or a consumer who upgraded without installing) never throws. `parsePhp` returns `{ unavailable: true }`, and the analyzer records coverage `text-only` with reason `parser-unavailable`.
- Options: `{ parser: { extractDoc: true, suppressErrors: false, version }, ast: { withPositions: true } }`. `version` defaults to `'8.3'` and comes from `.chemxrc` `php.version` when set.
- A parse error returns `{ error: { line, column, message } }` with `lineNumber`, `columnNumber` and the message trimmed of the trailing `on line N`.
- Minified or vendored files (size over 64 KB and mean line length over 200 characters) return `{ skipped: 'minified' }` without parsing.
- Results are cached per process, keyed by content hash and version, in an LRU capped at 2 MB of total source bytes (about 60 MB of trees). Files over 1 MB are parsed but not cached.
- `cli/php/php-walk.js` provides what php-parser lacks: parent linking, a generic `walk`, `scopeOf` (nearest `function`, `method`, `closure` or `arrowfunc`, else the program), `walkScope` (does not enter nested functions or classes), and small helpers for call names (`fn`, `$obj->m`, `C::m`), literal values and line ranges.

### 3.3 Module layout

All PHP code lives flat in `cli/php/`, one responsibility per file, each well under 500 lines. Specs sit next to them as `cli/php/*.spec.js`, and the kit `test` script gains the glob `cli/php/*.spec.js` in the dependency task.

| File | Responsibility |
| :--- | :--- |
| `php-parse.js` | lazy loader, parse, cache, minified check, `isPhpPath` |
| `php-walk.js` | parent links, walk, scopes, call-name and literal helpers |
| `php-test-kit.js` | `buildPassContext(code, { path, config })` for unit specs |
| `php-comments.js` | comment regions and the file header range from `program.comments` |
| `php-analyzer.js` | the PHP branch of the rule runner: parse, coverage, pass list, registry finalize |
| `php-metrics.js` | COMPLEXITY_CYCLOMATIC_HIGH, STRUCTURAL_WEIGHT_EXCEEDED |
| `php-control-flow.js` | CONTROL_FLOW_NESTED_TERNARY, CONTROL_FLOW_CASCADE_GUARDS, CONTROL_FLOW_SILENT_GUARD |
| `php-catch.js` | ERROR_SWALLOWED_EXCEPTION, AI_SLOP_SHALLOW_CATCH |
| `php-logging.js` | UNGUARDED_LOGGING |
| `php-taint.js` | request sources, sanitizers, per-scope assignment index, value taint and URL host taint |
| `php-dangerous.js` | SECURITY_DYNAMIC_CODE_EXECUTION, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION |
| `wp-detect.js` | WordPress project detection |
| `php-facts.js` | per-file facts: classes, functions, calls, writes, auth and nonce checks, registrations |
| `wp-project-index.js` | per-plugin index of facts, callable resolution, bounded reachability |
| `wp-rest-endpoints.js` | `register_rest_route` endpoint, method and permission resolution |
| `wp-route-rules.js` | SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK, SECURITY_WP_PUBLIC_READ_SIDE_EFFECT |
| `wp-nonce.js` | SECURITY_WP_MISSING_NONCE |
| `wp-sql.js` | SECURITY_WP_UNPREPARED_SQL |
| `wp-request-flow.js` | SECURITY_WP_UNSANITIZED_INPUT, SECURITY_WP_SSRF, SECURITY_WP_OPEN_REDIRECT |
| `wp-output.js` | SECURITY_WP_UNESCAPED_OUTPUT (default off) |
| `php-symbols.js` | declarations with ranges, for outline and index |
| `php-outline.js` | outline rendering |
| `php-rules-registry.js` | registry entries for the new rule ids, spread into `RULE_REGISTRY` |
| `php-rule-fixtures.js` | merges the per-family fixture modules into `PHP_FIXTURES` |
| `*.fixtures.js` | one fixture module per rule family, `{ RULE_ID: { path, config, bad, good } }` |

Fixtures are JS strings, never `.php` files on disk: the kit audits itself, and a `.php` fixture would be scanned once PHP is registered.

### 3.4 Pass interface

A PHP pass is `(ctx) => void`. `ctx` is:

```
{ ast, content, lines, filePath, relativePath, ruleConfig, config,
  wp: { isWordPress, root, kind } | null,
  index: ProjectIndex | null,
  report(rule, nodeOrLine, hazard, extra) }
```

`report` records `{ rule, line, column, endLine?, tryBraceLine?, hazard, severity? }`. Passes never read `RULE_REGISTRY`. `php-analyzer.js` finalizes each record with `pillar`, `directive` and the default `severity` from the registry, so rule families can be built and tested before their ids are registered. Generic PHP passes run on every PHP file; WordPress passes run only when `ctx.wp.isWordPress`. A pass whose every rule is off for the file (per `resolveRuleSettings`) is skipped.

### 3.5 Plugging into collectRawViolations and coverage

`cli/audit/rules.js` `collectRawViolations` gets one branch, placed before the Babel eligibility check:

1. Text passes run as today on every file. For PHP, `AI_SLOP_ECHO_COMMENT` is dropped (58% precision; see section 4).
2. If the path is PHP: with `--fast`, coverage is `text-only` with reason `fast`. Otherwise `analyzePhp` parses. A parse error pushes `SYNTAX_PARSE_ERROR` at the parser's line and column and records coverage `parse-error`. Parser unavailable or minified records `text-only` with that reason. Otherwise the pass list runs and coverage is `ast`.
3. PHP never reaches `parseScriptAsts`, `runAstPasses`, `runTailwindUnscannedPass` or the SFC passes.
4. `hasHighComplexity` and `checkLineBudgets` run as today. The PHP analyzer emits the same `COMPLEXITY_CYCLOMATIC_HIGH` id and reads the same `maxCyclomaticComplexity` key.
5. `auditCode` passes the PHP comment regions and header range to `applyAuditPostFilters`.

`cli/audit/coverage.js` records an optional `language` and `reason` per file and adds `byLanguage` to `summarizeCoverage` (`{ php: { files, ast, textOnly, parseErrors } }`). `cli/audit/audit-summary.js` prints one line per language when more than one language was scanned.

### 3.6 Comments and suppression

- Comment regions for PHP come from `program.comments`, not from `cli/audit/comment-regions.js`, which misreads `?>` inside line comments, multi-line quoted strings and heredocs.
- `applyAuditPostFilters(raw, lines, { commentRegions, fileHeaderEndLine })` accepts precomputed regions. JS callers pass nothing and behave exactly as today.
- Annotation forms on PHP: `// chemx-allow: RULE reason`, `# chemx-allow: RULE reason`, `/* chemx-allow: RULE reason */`. A PHP 8 attribute `#[...]` is not a comment; the parser already tells them apart.
- File-level findings sit on line 1, the `<?php` line. An annotation anywhere in the file's leading comment block (the comments before the first statement) also applies to line-1 findings. This applies to every language that reports a header range; only PHP does in this epic.
- Catch findings carry `endLine` and `tryBraceLine`, so annotations inside the catch work as they do for JS. For the second and later catches of one `try`, `tryBraceLine` is the closing brace line of the previous catch.

### 3.7 WordPress project detection and config

`.chemxrc` keys, read by `cli/config/loader.js` and passed through to `auditCode`:

| Key | Values | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `wordpress` | `"auto"`, `true`, `false` | `"auto"` | `false` turns every WordPress rule off; `true` treats every PHP file as WordPress |
| `php.version` | a PHP version string | `"8.3"` | php-parser target version |

Auto detection, per file, nearest directory wins, cached per directory: walk from the file's directory up to the scan root and stop at the first directory that

1. holds a top-level `*.php` whose first 8 KB matches `^[ \t/*#@]*Plugin Name:` (plugin), or
2. holds a `style.css` with `Theme Name:` (theme), or
3. holds `wp-config.php` or `wp-includes/version.php` (core; applies only to files under its `wp-content/`).

A path segment `/wp-content/(plugins|mu-plugins|themes)/<name>/` also marks `<name>` as the root. Only when the file is not on disk (content-only audits, fixtures) does detection fall back to AST signals: `add_action`, `add_filter`, `register_rest_route`, `$wpdb`, `WP_REST_Request`, or an `ABSPATH` guard.

Measured: the header check detects 40 of 40 plugin directories and the plugin nested in `apps/glowitheflow/wordpress-plugin`, and correctly rejects `apps/lawfirm` (14 non-WordPress PHP files). The AST fallback alone would detect only 405 of 674 files, because helper classes carry no WordPress signal.

### 3.8 Per-plugin project index

Missing-nonce, public-route and request-flow rules need callbacks that live in another class or file (the card vault image route reaches its SSRF and disk write two hops away in `Card_Vault_Image_Cache::cache_remote_image`). `wp-project-index.js` provides this without a new pre-pass in `cli/audit-scan.js`:

- It is built lazily per WordPress root and cached per process. It lists the root's tracked PHP files with one `git ls-files` (outside git: a walk that skips `vendor/` and `node_modules/`), so ignored third-party code is never read.
- It stores compact per-file facts from `php-facts.js`, not trees: classes with `extends` and `use` traits; functions and methods with line ranges, parameters, calls (receiver kind `func`, `this`, `self`, `static`, `parent`, `static-class`, `var-new`), state writes, outbound requests, auth checks, nonce checks, a `returnsTrueOnly` flag and parameter-to-sink summaries; and registrations (`register_rest_route` endpoints, `add_action` and loader `->add_action` hooks, `wp_ajax_*` and `admin_post_*` map entries).
- Callable resolution handles `'fn'`, `'C::m'`, `['C','m']`, `[$this,'m']`, `[self::class,'m']`, `array(__CLASS__,'m')`, closures, `$x = new C` in the same function and `$this->prop = new C`. It follows `extends` chains and traits. The u4 spike resolved 1,719 of 1,753 resolvable sites this way.
- `reaches(ref, predicate, { hops: 2 })` follows calls through the index, cycle-safe.
- Each entry is invalidated by file size and mtime. The file being audited is overlaid with the content passed to `auditCode`, so the HEAD re-audit in the `task done` gate sees HEAD content for the target and disk content for the rest.
- Caps: 400 files or 8 MB of source per root. Above the cap the index holds only the audited file and coverage carries reason `wp-index-capped`. This protects explicit audits of large third-party plugins (woocommerce has 4,044 PHP files).
- When a rule needs a callee's tree, the index re-parses through the `php-parse.js` cache.

Results for one file can now depend on other files of the same plugin. This is documented in `docs/php-wordpress.md` and matches how the rules are defined.

### 3.9 Finding anchors

A finding sits in the file that must change, so triage targets the right file:

- SECURITY_WP_PUBLIC_WRITE_ROUTE: the `permission_callback` entry line in the registering file.
- SECURITY_WP_REST_NO_PERMISSION_CALLBACK: the endpoint array line.
- SECURITY_WP_PUBLIC_READ_SIDE_EFFECT: the `callback` entry line of the route; the hazard names the side effect's file and line.
- SECURITY_WP_MISSING_NONCE: the callback's declaration line, in the callback's file; the hazard names the registration's file and line.
- SSRF, open redirect, unsanitized input, unprepared SQL, dangerous functions: the sink line. A one-hop flow whose request read and sink are in different files is anchored at the call site that passes the request value, and the hazard names the sink.

## 4. Rules

"Shipped" is the default with no `.chemxrc` setting. A default-off rule is enabled with `rules: { RULE_ID: "<severity>" }`. Default-off is a new registry field, `isDefaultOff: true`, honored by `cli/audit/rule-overrides.js` when no setting names the rule. Rules with labelled precision under 80% ship off or are cut, as the table says.

| Rule id | Reused or new | Severity | Needs | Pillar / category | Detection summary | Corpus hits | Labelled precision | Shipped |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| SECURITY_WP_PUBLIC_WRITE_ROUTE | new | HIGH | standard | 9 Security | Endpoint whose methods include POST, PUT, PATCH or DELETE and whose permission is `'__return_true'`, a closure or arrow fn returning only `true`, or a resolvable callable whose body is only `return true`. Guard: skip when the resolved callback calls `current_user_can`, `is_user_logged_in`, `wp_verify_nonce`, `hash_equals`, `wp_check_password`, `wp_signon`, `get_current_user_id`, or a method matching `/verify\|validat\|auth\|signature\|token\|guard\|permission\|can_/`. | 76 | 19/22 (86%) directive; 50% real holes | on |
| SECURITY_WP_REST_NO_PERMISSION_CALLBACK | new | HIGH | light | 9 Security | Endpoint array with no `permission_callback` key. | 0 | definitional | on |
| SECURITY_WP_PUBLIC_READ_SIDE_EFFECT | new | HIGH | standard | 9 Security | Public endpoint with no write verb whose callback reaches, within 2 hops, `dbDelta`, option or meta writes, `wp_insert_*`/`wp_update_*`/`wp_delete_*`, file writes, `wp_remote_*`, `download_url`, `wp_mail`, user creation, auth cookies, scheduling or `$wpdb` writes. `wp_remote_retrieve_*` and `set_transient` excluded. | 8 | 5/8 (62.5%) | off |
| SECURITY_WP_UNPREPARED_SQL | new | CRITICAL | standard | 9 Security | `$wpdb` (or `$this->wpdb`, `$this->db`) `query`/`get_results`/`get_var`/`get_row`/`get_col` whose SQL is not `->prepare()` and contains an unsafe value; `prepare()` whose query string interpolates an unsafe value; `esc_like()` without `prepare`; LIKE wildcards built from unsafe values without `esc_like`. Safe-value classifier as in the u2 report, plus the guard that values read back from the database through `$wpdb` count as safe. | 12 raw; 9 expected with the guard | 8/9 (89%) with the guard | on, only if the precision spec reproduces 8/9; otherwise off |
| SECURITY_WP_UNESCAPED_OUTPUT | new | MEDIUM; HIGH when request-derived | light | 9 Security | `echo`, `<?=` and `print` of a value that is not a literal, constant, numeric cast or escaper result. Guards: `wp_create_nonce`, `date`/`current_time`, `->ID`/`->term_id`/`->count`, scopes that send a non-HTML `Content-Type`. | 124 | 8/10 (80%) on a 10-hit sample | off: 10 labels for 124 hits is too thin; revisit with a 30-hit sample |
| SECURITY_WP_UNSANITIZED_INPUT | new (sink variant only) | HIGH | light | 9 Security | A superglobal or request value reaches `echo`, a `$wpdb` query, an option or meta write, `wp_insert_post`/`wp_update_post`, `header`, `setcookie`, `file_put_contents`, `unserialize`, `extract`, `call_user_func` or `include` in the same function with no sanitizer between. URL sinks belong to SSRF and redirect. | 9 | 8/9 (89%) | on |
| SECURITY_WP_MISSING_NONCE | new | HIGH | standard | 9 Security | A `wp_ajax_*` or `admin_post_*` handler (via `add_action`, loader `->add_action`, or a hook-to-method map) that reaches a state write within 2 hops and no `check_admin_referer`, `check_ajax_referer`, `wp_verify_nonce`, or function or method matching `/nonce\|referer\|csrf/` within 2 hops. | 32 | 29/30 (97%) | on |
| SECURITY_WP_SSRF | new | HIGH | standard | 9 Security | A request-controlled URL host reaches `wp_remote_get`/`post`/`request`/`head`, `download_url`, `file_get_contents`, `fopen`, `curl_init`, `media_sideload_image` or `getimagesize`, directly or through one call. Killed by `wp_http_validate_url` on the variable before the sink. `wp_safe_remote_*` are not sinks. | 8 (with redirect) | 8/8 (100%) | on |
| SECURITY_WP_OPEN_REDIRECT | new | MEDIUM | standard | 9 Security | A request-controlled URL host reaches `wp_redirect`. Killed by `wp_validate_redirect`; `wp_safe_redirect` is not a sink. | see SSRF | 8/8 (100%) | on |
| SECURITY_DYNAMIC_CODE_EXECUTION | reused | CRITICAL | standard | 9 Security | `eval`, `create_function`, `assert` with a string or variable, `preg_replace` with an `e` modifier. | 2 combined with the two rules below | 2/2 | on |
| SECURITY_PHP_OBJECT_INJECTION | new | HIGH | standard | 9 Security | `unserialize` without an `allowed_classes` option; `maybe_unserialize` only when request-derived. | see above | see above | on |
| SECURITY_PHP_COMMAND_EXECUTION | new | CRITICAL | standard | 9 Security | `shell_exec`, `exec`, `system`, `passthru`, `proc_open`, `popen`, `pcntl_exec`, backtick shell strings. | see above | see above | on |
| SECURITY_WP_CREDENTIAL_OPTION | proposed | n/a | n/a | n/a | Literal credential keys in `get_option` family calls. | 3 | 0/3 | cut |
| COMPLEXITY_CYCLOMATIC_HIGH | reused | MEDIUM for PHP | standard | 2 Control flow | Every function, method, closure and arrow fn on its own: 1 plus if, elseif, ternary (including `?:`), case with a test, match arm conditions, `&&`, `\|\|`, `and`, `or`, `??`, for, foreach, while, do-while, catch. Fires over `maxCyclomaticComplexity` (12 by default). | 316 | 10/12 (83%) | on |
| STRUCTURAL_WEIGHT_EXCEEDED | reused | MEDIUM for PHP | deep | 1 Line budgets | Braced control nesting depth of 4 or more per function; elseif adds no depth; nested functions excluded. | 99 | 10/10 | on |
| CONTROL_FLOW_NESTED_TERNARY | reused | MEDIUM for PHP | light | 2 Control flow | A ternary whose true or false branch is a ternary, outermost of the chain only. Pure `?:` chains are exempt. PHP 8 makes unparenthesized left nesting a compile error, which removes the precedence trap behind the CRITICAL rating. | 129 | 12/12 | on |
| CONTROL_FLOW_CASCADE_GUARDS | reused | registry (MEDIUM) | standard | as registered | 3 or more if-without-else guards ending in `throw` or bare `return;`, followed by an action; plain `$x = ...;` statements are skipped. | 25 | 8/10 (80%) | on |
| CONTROL_FLOW_SILENT_GUARD | reused | registry | standard | as registered | Bare `return;` under an error-ish test in a function named like a mutation (snake_case `handle_`, `on_`, `save_`, ... allowed). PHP vocabulary: a preceding error response (`wp_send_json_error`, `send_json_response`/`output_json` with `success => false`, `wp_die`, `status_header`, `error_log`) makes the guard non-silent. | 1 | 1/1 | on |
| ERROR_SWALLOWED_EXCEPTION | reused | registry | standard | as registered | Catch that is empty or comment-only, or has no throw, call, `new`, echo, exit, return with a value, or assignment to anything other than the catch variable. | 9 | 9/9 | on |
| AI_SLOP_SHALLOW_CATCH | reused | registry | standard | as registered | Catch body is one `error_log`, `trigger_error`, `var_dump`, `print_r`, `var_export`, `dump` or `dd` call. | 3 | 3/3 | on |
| UNGUARDED_LOGGING | reused | registry (LOW) | light | 7 Global hygiene | `var_dump`, `print_r`/`var_export` without `true`, `dd`, `dump`, `debug_print_backtrace`, `debug_zval_dump`; `error_log` only when it has no `WP_DEBUG` guard, is not in a catch or error-ish branch, and carries no error wording. | 2 | 2/2 | on |
| LINE_BUDGET_FILE | reused | registry (500 MEDIUM, 1,000 HIGH, 2,000 CRITICAL) | standard | 1 Line budgets | Unchanged. | 56 | exact | on |
| VIEW_MONOLITH | reused | registry (HIGH, CRITICAL at 500) | deep | 1 Line budgets | New PHP view tier: `.php` under `partials/` or `templates/` over 200 lines. No molecule tier for PHP. | 4 | 4/4 | on |
| SYNTAX_PARSE_ERROR | reused | registry (CRITICAL) | standard | 1 Line budgets | php-parser error at its own line and column. | 0 | n/a | on |
| SYNTHETIC_MOCK_DATA and the other text passes | reused | registry | as registered | as registered | Unchanged text passes. | 1 | borderline | on |
| AI_SLOP_ECHO_COMMENT | reused | registry | as registered | as registered | Text pass compares comments with string contents; on PHP it fires on section banners and SQL text. | 83 | 7/12 (58%) | off for `.php` (dropped by the PHP branch); an AST-identifier variant is a follow-up |
| SECURITY_WP_UNSANITIZED_INPUT read-site variant | proposed | n/a | n/a | n/a | WPCS-style check of every superglobal read. | 38 | 3/10 (30%) | cut |

Per-violation severity for PHP (complexity, structural weight, nested ternary at MEDIUM) uses the same mechanism as `TIMER_DISCIPLINE` and the line budgets. The reason is plan C in section 2.5: at registry severities, 157 plugin files (21 of 25 card vault files) would block `task done` on structural debt, which would stall every security fix. At MEDIUM, a count rise still blocks `task done` through the per-rule delta, so PHP structure cannot get worse in a file a task touches.

New registry entries carry the directives from the u2 report, for example SECURITY_WP_MISSING_NONCE: "Verify a nonce (check_ajax_referer / check_admin_referer / wp_verify_nonce) and a capability before changing state in admin-ajax and admin-post handlers".

## 5. Gates and ratchets

### 5.1 Ruleset 7

`RULESET_VERSION` goes from 6 to 7. Revision 7 is recorded for:

- the 11 new ids (SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK, SECURITY_WP_PUBLIC_READ_SIDE_EFFECT, SECURITY_WP_UNPREPARED_SQL, SECURITY_WP_UNESCAPED_OUTPUT, SECURITY_WP_UNSANITIZED_INPUT, SECURITY_WP_MISSING_NONCE, SECURITY_WP_SSRF, SECURITY_WP_OPEN_REDIRECT, SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION);
- every existing rule that can now fire on a `.php` file: the reused AST ids in section 4, LINE_BUDGET_FILE, VIEW_MONOLITH, SYNTAX_PARSE_ERROR, SECURITY_DYNAMIC_CODE_EXECUTION, and every text-pass rule run by `runTextPasses` (the builder enumerates them from `rules-helpers.js`, `ai-slop-detector.js` and `extended-text-patterns.js`).

`rule-revisions.spec.js` gains a ruleset 7 snapshot, plus a check that every rule id emitted by any PHP bad fixture has revision 7 or later.

### 5.2 Existing chemx-ratchet.json files

- In this monorepo only the kit has a `chemx-ratchet.json` (checked 2026-10-24). Its counts are all 0 and the kit has no PHP, so nothing changes for it except that the next ratchet write records ruleset 7.
- None of the 40 plugins has a ratchet or a `.chemxrc`, so no plugin ratchet turns red.
- Published consumers with PHP and a ratchet: a ratchet baseline recorded under an older revision of a rule does not gate that rule, so the first ruleset 7 scan adopts the new counts. The cost, accepted and documented in `docs/CHANGELOG.md`: that one scan also adopts any JS increase of the bumped rules. Per-language ratchet keys are a follow-up if a consumer needs them.

### 5.3 The task-done gate and deltas

- `task done` re-audits the target at HEAD with the current engine and compares rule counts (`cli/audit/staged-delta.js:65-71`, `cli/audit/gate-delta.js:51-65`). Nothing is stored, so an unchanged PHP file is neutral.
- The gate still refuses any target with a CRITICAL or HIGH finding (`cli/team/team-triage-verify.js:74-80`). After the registration task, PHP targets stop passing trivially. On the plugin corpus, 20 files carry a structural HIGH or CRITICAL (plan C), plus files with HIGH or CRITICAL security findings.
- For #6116: card vault tasks that target `includes/class-card-vault-api.php` (1,775 lines, LINE_BUDGET_FILE HIGH) or `includes/class-card-vault-catalog-rest.php` (1,014 lines, HIGH) cannot pass the gate by fixing the security issue alone. They move the fixed handlers into a new file and target that file, or a split task runs first. `--force` stays off-limits.
- Before the registration task lands, the orchestrator lists in-progress tasks whose target is a `.php` file (`chemx team task list --status=in_progress --all-repos`) and posts a decision naming them, because their gate changes underneath them.
- Base deltas (`--delta-base`), the pre-commit hook and `verify --changed` cover PHP once `audit-preflight-git.js` uses `languages.js`. A commit that raises a PHP rule count in a staged file is treated exactly like a JS one.

### 5.4 Audit grades for the 40 plugins

Health and AI-slop scores fall when PHP files start counting (card vault goes from 2 scanned files to 27). `status-file` already records `ruleset`, so trend views mark the break at ruleset 7. Plugin-level `chemx verify` (no ratchet, so the CRITICAL/HIGH gate) turns red for plugins with such findings; the monorepo root verify skips submodule folders and is unaffected.

### 5.5 Rolling out without a triage flood

- Triage is opt-in since #5480 (`--triage` or `.chemxrc` `autoTriage: true`), and one run files at most `TRIAGE_RUN_CAP` (50) tasks. No plugin and not the monorepo root sets `autoTriage`. The README line that still says triage is the default is corrected in the docs task.
- Only the card vault is triaged in this epic, under #6116. Other plugins are audited with `--no-triage` if at all; triaging them is a separate decision per plugin, asked of the owner first.
- Default-off rules and the PHP MEDIUM severities keep the first card vault run inside one or two capped runs.

## 6. Search and outline

Needed now, because triage tasks carry line numbers and an agent maps a line to its method through the outline (which `chemx read` shows by default for files over 100 lines), and because index rows feed triage `lines`, `tier` and `health_score`:

- `php-symbols.js`: one walker over the tree yielding `{ name, container, kind, visibility, isStatic, isAbstract, startLine, endLine, signature }` for namespaces, classes, interfaces, traits, enums, functions, methods, properties and constants. Uses `parsePhp` with `suppressErrors: true` retried on error, so a broken file still gets a partial outline.
- `php-outline.js` and a PHP branch in `cli/reader.js` ahead of the polyglot branch, with ranges on member lines: `L14-1775  class Card_Vault_API`, `  L24-256  public function register_routes()`.
- `--logic` on PHP prints "logic skeleton not available for PHP; use --outline or --symbol" instead of a Babel `Unexpected token (1:1)`.
- `cli/search-ast.js` `extractAstMetadata` gets a `.php` branch built on `php-symbols.js`, and `.php` is excluded from the regex fallback so a parse failure yields no symbols rather than invented ones. Methods are indexed under their own name with `Class::method` in the signature. No `INDEX_VERSION` bump is needed: no PHP rows exist yet, and the extractor lands before PHP becomes a source file.
- `cli/search-scan.js`: an explicit `--dir` keeps git-ignored files only when the named directory is itself wholly ignored, the same rule as `discoverSourceFiles`. Without this, `chemx q x --dir=wp-content/plugins` would index about 30,000 ignored third-party PHP files once `.php` is a source file. This lands before the registration task.

Follow-ups, not in this epic: `--symbol` through the PHP tree with `Class.method` and `Class::method`; a `container` column in `symbols` and `INDEX_VERSION` 3; PHP file edges for `--blast-radius` and `backtrace`; PHP callee extraction for `trace`; a `wp_registrations` table and an outline section listing routes and hooks; WordPress tier mapping in `search-ast.js`; fixing `trace` printing `Defined in: <target>:1` for unknown targets.

## 7. Performance budget

Measured basis: parser load 107 to 117 ms once per process; parse mean 6.3 ms, max 256 ms per non-minified file; 4.2 s for the 674-file corpus; prototype rule passes 1 to 7 s each over the corpus, one 34 s outlier caused by a quadratic assignment scan.

| Scope | Budget |
| :--- | :--- |
| Parser load | lazy, once per process; zero cost for scans with no PHP |
| One file (non-minified, up to 2,000 lines) | parse plus all PHP passes at most 400 ms; corpus mean at most 30 ms |
| One plugin, cold (card vault: 25 PHP files, 12,455 lines) | added audit time at most 2 s, including parser load and the project index |
| Plugin corpus (674 files) in one process | all PHP passes at most 20 s; peak heap growth at most 400 MB |
| Memory | parse cache 2 MB of source (about 60 MB of trees); the project index keeps facts, not trees |
| Minified or vendored files | not parsed (size over 64 KB and mean line length over 200) |

Rules: every taint and assignment lookup uses a per-scope index built in one pass; no rule rescans a scope per use. The budgets are checked in the re-audit task with timings recorded on #6116, not in `node --test`, where machine load makes timing assertions flaky.

## 8. Testing

All specs use `node --test`, run as `chemx test <spec>` from the kit. Code fixtures are minimal inline snippets with generic names (`demo_save`, `Demo_Client`); no realistic names, emails or seed data.

- Fixture pairs: every new rule id and every reused id that PHP emits has a PHP `{ path, config, bad, good }` pair in a family `*.fixtures.js` module. `php-rule-fixtures.js` merges them into `PHP_FIXTURES`. `cli/audit/rule-fixtures.spec.js` treats a rule as covered when it is in `FIXTURES` or `PHP_FIXTURES`, runs every PHP pair (bad fires, good stays silent), checks that each default-off rule's bad fixture is silent without config, and extends the "engine only emits registered ids" scan to `cli/php/*.js`. WordPress fixtures use a path such as `wp-content/plugins/demo/demo.php` and `config: { wordpress: true }`.
- Analyzer unit specs: `php-parse.spec.js` (lazy load, cache, error shape, minified skip, unavailable module), `php-walk.spec.js`, `php-analyzer.spec.js` (coverage kinds, `--fast`, parse error position, echo-comment drop, registry finalize, no Babel call for PHP), `php-comments.spec.js` and a PHP case in `cli/audit/suppressions.spec.js` (`//`, `#`, `/* */`, `?>`-terminated comment, annotation inside a multi-line string ignored, header annotation for line-1 findings, second catch `tryBraceLine`), `wp-detect.spec.js` (temp directories), `wp-project-index.spec.js` (temp plugin directory in a temp git repo with an ignored folder).
- Precision regression specs, one per family (`php-structure.precision.spec.js`, `php-catch.precision.spec.js`, `php-dangerous.precision.spec.js`, `wp-routes.precision.spec.js`, `wp-nonce.precision.spec.js`, `wp-sql.precision.spec.js`, `wp-request-flow.precision.spec.js`). Each case is a minimal snippet that reproduces the shape of one labelled hit, tagged `TP` or `FP`, with `origin` naming the corpus file and line it was reduced from. Every TP must fire. Every FP removed by a guard must stay silent. Known FPs that still fire are tagged `known: 'FP'`. The spec computes precision over its cases and fails below the shipped threshold (80% for default-on rules).
- Integration specs: a PHP case in `cli/team/team-done-delta.spec.js` (unchanged PHP file neutral; added hazard refused), `cli/languages.spec.js` PHP cases, an audit discovery spec with a tracked plugin and an ignored PHP folder, `cli/reader-php.spec.js` (return types, `( $a = array() )` defaults, braces in strings, two classes with the same method name, trait, abstract, static, closure on a hook, namespace, inline HTML) and `cli/search-php.spec.js`.
- Gate: `chemx verify` stays green in the kit after every task. The full suite runs once, at the gate of the registration task, on a clean tree.

## 9. Docs

- `README.md`: a PHP row in the language table ("PHP: php-parser 3.7.0 AST; structural, catch and security rules; WordPress rules when a plugin, theme or core root is detected"), a Tier 2 bullet, the Python, Go and Rust rows corrected to "universal text passes" (they get no structural analysis today), and the triage paragraph corrected to opt-in.
- New `docs/php-wordpress.md`: supported syntax and version, config keys, WordPress detection, the rule table with shipped defaults and how to enable default-off rules, annotation forms, the per-plugin index and its caps, coverage reasons, performance numbers.
- `docs/audit-gates.md`: the source-file list now comes from `languages.js`; PHP severities and the gate impact.
- `docs/INDEX.md`: link the new page.
- `docs/CHANGELOG.md`: ruleset 7 entry naming every new id, every revision bump, the adoption cost for ratchets, and the new `php-parser` dependency.
- `chemx docs check` passes.

## 10. Rollout

1. Dependency: `php-parser@3.7.0` in the kit, and the `cli/php/*.spec.js` test glob.
2. Parser and walker, then the analyzer branch in `rules.js` (dark: only direct `auditCode` calls see PHP).
3. In parallel: structural rules, catch and logging rules, taint and dangerous functions, WordPress detection, symbols and outline (live for `chemx read` at once), the search-scan ignore fix.
4. Facts and the per-plugin project index.
5. In parallel: route rules, nonce rule, SQL rule, request-flow and output rules.
6. Registration of rule ids, ruleset 7, fixture wiring and the pass list.
7. Language registration: `.php` becomes a source file; preflight uses `languages.js`. Preceded by the orchestrator's decision post on in-flight PHP-target tasks.
8. Docs.
9. Re-audit `wp-content/plugins/xophz-compass-card-vault` with `--triage`; attach the triage tasks to #6116; record before (2 files scanned) and after, the per-rule counts, coverage, timings, and which manual-review bug classes the audit now catches.

The kit commits to `main` with `[skip ci]` until #1948 lands. The root submodule pointer bump and the root `pnpm-lock.yaml` change are a separate root step coordinated with the session that holds the root lockfile.


## Task map

Tasks live in `.chemx/index.db` under epic #6429; this table only maps the spec keys to ids.

| Key | Task |
| :--- | :--- |
| T1-dep | #6469 |
| T2-parse | #6470 |
| T3-analyzer | #6471 |
| T4-structure | #6472 |
| T5-catch-log | #6473 |
| T6-taint-danger | #6474 |
| T7-wp-detect | #6475 |
| T8-wp-index | #6476 |
| T9-wp-routes | #6477 |
| T10-wp-nonce | #6478 |
| T11-wp-sql | #6479 |
| T12-wp-flow | #6480 |
| T13-outline | #6481 |
| T14-scan-ignored | #6482 |
| T15-registry | #6483 |
| T16-language-flip | #6484 |
| T17-docs | #6485 |
| T18-reaudit | #6486 |

Status note (2026-10-24): this is the architect draft. An adversarial critique (precision, integration and gates, task breakdown) and a revision are running; changes they make land in this file and in the task descriptions before the affected tasks are dispatched.
