# PHP and WordPress auditing

`chemx audit`, `chemx check`, the edit guardrails (`patch`, `write`) and `chemx team task done` read `.php` files with `php-parser` and run PHP rules and, inside a WordPress plugin, theme or core tree, WordPress rules. The design is in `docs/superpowers/specs/2026-10-24-chemx-php-audit-design.md` (epic #6429). This page states what ships and what is not guaranteed.

Status note: the `.php` extension is switched on for every audit caller by one registration step in `cli/languages.js` (task T16 of the epic). The PHP modules under `cli/php/` are inert until that step is on `main`. Check `chemx q -g "'.php'" -l cli/languages.js` before relying on this page.

## Syntax and version

- Parsing always uses one constant, `PHP_PARSE_VERSION`, the newest PHP version `php-parser` 3.7.0 accepts. Valid newer syntax is therefore never reported as `SYNTAX_PARSE_ERROR`.
- `.chemxrc` `php.version` (default `"8.3"`) is the deployment target. Rules that depend on the target read it; today that is the `assert` sub-rule of `SECURITY_DYNAMIC_CODE_EXECUTION` (a string argument to `assert` is code only before PHP 8.0). It does not change how files are parsed, and version-gated syntax findings are not built.
- `create_function` and the `e` modifier of `preg_replace` do not run on PHP 8. Those findings only matter in code that still targets PHP 7 or older.
- `php-parser` is loaded on the first `.php` file audited, never earlier. A scan with no PHP files does not load it. If the module is missing, the file gets coverage `text-only` with reason `parser-unavailable`; nothing throws.
- Files that look minified are not parsed (coverage `text-only`, reason `minified`).

## Config keys

| Key | Values | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `wordpress` | `"auto"`, `true`, `false` | `"auto"` | `false` turns every WordPress pass off. `true` treats every PHP file as WordPress. |
| `php.version` | a PHP version string | `"8.3"` | The deployment target that version-sensitive rules read. |

Config caches are keyed by file mtime, so a long-lived process sees `.chemxrc` changes without a restart. A long-lived MCP server still runs the chemx code it loaded at start; use the CLI to check chemx changes.

## WordPress detection

With `wordpress: "auto"`, detection runs per file. It walks from the file's directory up to the scan root and stops at the first directory that holds one of these:

- a top-level `*.php` whose first 8 KB matches a `Plugin Name:` header (plugin);
- a `style.css` with `Theme Name:` (theme);
- `wp-config.php` or `wp-includes/version.php` (core, only under its `wp-content/`).

A path segment `wp-content/(plugins|mu-plugins|themes)/<name>/` also marks `<name>` as the root. The nearest directory wins. When a file is audited from content alone (no path on disk), detection falls back to signals in the code: `add_action`, `add_filter`, `register_rest_route`, `$wpdb`, `WP_REST_Request` or an `ABSPATH` guard. These are heuristics; set `wordpress: true` or `false` when they are wrong for a project.

## Rules and defaults

"Shipped" is the default with no `.chemxrc` setting, read from the rule registry and each family's `RULE_DEFAULTS` in `cli/php/` (collected as `PHP_RULE_DEFAULTS` in `cli/php/php-analyzer.js`). Precision figures are labelled samples from the 674 tracked PHP files in the monorepo plus a held-out set, not guarantees. If this page and the code disagree, the code wins.

| Rule id | Severity | Shipped | What it flags |
| :--- | :--- | :--- | :--- |
| `SECURITY_WP_PUBLIC_WRITE_ROUTE` | MEDIUM | on | A REST route with a write verb and a public permission (`__return_true`, or a callback that only returns `true`) whose callback reaches a state write or outbound request within 2 hops, with no auth-like call on the way. |
| `SECURITY_WP_REST_NO_PERMISSION_CALLBACK` | HIGH | on | A REST endpoint with no `permission_callback`, using WordPress core's own endpoint-array rules. |
| `SECURITY_WP_PUBLIC_READ_SIDE_EFFECT` | HIGH | off | A public read-only route whose callback reaches a write or outbound request. 5 of 8 labelled hits were real. |
| `SECURITY_WP_MISSING_NONCE` | HIGH | on | A `wp_ajax_*` or `admin_post_*` handler that reaches a state write with no nonce check within 2 hops. |
| `SECURITY_WP_AUTH_ERROR_CLEARED` | MEDIUM | on | A callback on the `rest_authentication_errors` filter (closure, arrow function, `array( $this, name )` or a function name in the same file) that returns `null` or `true` and calls no credential check or `wp_set_current_user( 0 )`. A shape match: callbacks in other files or classes are not followed and which routes it affects is not checked. Corpus 6/6, held-out 2/2 (2 hits only). |
| `SECURITY_WP_PUBLIC_REGISTRATION_ROUTE` | HIGH | off | A public REST route with a write verb whose path is named for registration (`register`, `signup`, `join`, `create-user`) and whose callback reaches `wp_create_user`, `wp_insert_user`, `register_new_user` or `wc_create_new_customer` within 2 hops, with no `users_can_register` or registration-setting text in any function on the way. A captcha does not count. A name and text match: routes that create a user while signing in, an OAuth callback, a webhook or a checkout are not matched by name, and a setting read through a differently named helper is missed. Corpus 2/2, held-out 3/3 (5 hits only, under the 10 the bar names). |
| `SECURITY_WP_SHADOWED_ROUTE` | MEDIUM | off | A literal REST route registered after a regex route (`(?P<name>...)`) in the same file, with the same namespace (a literal, or the same variable in one function) and a shared verb, where the regex matches the literal path in full: WordPress runs the first match, so the later route does not run. A string and verb match within one file: routes registered in other files, or with non-literal route strings, are not compared. Corpus 0 hits, held-out 1/1 (card vault a708d6a `POST /catalog/cards/prices`; one hit, under the 10 the bar names). |
| `SECURITY_WP_UNBOUNDED_REQUEST_ARRAY` | MEDIUM | off | A REST callback with a write verb, declared in the audited file, that loops over an array read from the request (an element such as `$params['items']` or `get_param( 'items' )`) with a write, outbound request or save/insert/update call in the loop body, or passes such an array to a callee the project index resolves whose loop does, with no size limit found: no `array_slice`, `array_splice`, `array_chunk`, `array_diff`/`array_intersect`, and no `count()` compared with `<`, `<=`, `>` or `>=`, on that array in the function. A route whose file contains the string `maxItems` is skipped. A name and shape match in one function scope: a limit set elsewhere, a limit on a copy built from other calls, a second callee hop and loops with only in-memory work are not seen, and the route's permission is not checked. Corpus 12/12, held-out 13/16 (card vault a708d6a 5/5, third-party plugins 8/11; one reader, five large plugins not measured), so it ships off. |
| `SECURITY_WP_UNPREPARED_SQL` | HIGH, CRITICAL when request-derived | off | `$wpdb` queries whose SQL is not prepared and holds an unsafe value. |
| `SECURITY_WP_UNSANITIZED_INPUT` | HIGH | off | A superglobal value reaching a sink in the same function with no sanitizer. |
| `SECURITY_WP_SSRF` | HIGH | off | A request-controlled URL reaching an outbound HTTP or file function. |
| `SECURITY_WP_OPEN_REDIRECT` | MEDIUM | off | A request-controlled URL reaching `wp_redirect`. |
| `SECURITY_WP_UNESCAPED_OUTPUT` | MEDIUM, HIGH when request-derived | off | `echo`, `<?=` or `print` of a value that is not a literal or an escaper result. |
| `SECURITY_DYNAMIC_CODE_EXECUTION` | CRITICAL | on | `eval`, `create_function`, `preg_replace` with `/e`, and string `assert` below PHP 8. |
| `SECURITY_PHP_OBJECT_INJECTION` | HIGH | on | `unserialize` without `allowed_classes`. |
| `SECURITY_PHP_COMMAND_EXECUTION` | CRITICAL | on | `shell_exec`, `exec`, `system`, `passthru`, `proc_open`, `popen`, `pcntl_exec`, backtick strings. |
| `COMPLEXITY_CYCLOMATIC_HIGH` | MEDIUM for PHP | on | Function, method or closure above `maxCyclomaticComplexity` (12). |
| `STRUCTURAL_WEIGHT_EXCEEDED` | MEDIUM for PHP | on | Braced nesting depth 4 or more in one function. |
| `CONTROL_FLOW_NESTED_TERNARY` | MEDIUM for PHP | on | The outermost ternary of a nested chain. |
| `CONTROL_FLOW_CASCADE_GUARDS` | registry (LOW) | off for PHP | Three or more guard clauses before an action. |
| `CONTROL_FLOW_SILENT_GUARD` | registry | off for PHP | A bare `return;` under an error-ish test in a mutation-named function. |
| `UNGUARDED_LOGGING` | LOW | off for PHP | Dump functions and unguarded `error_log`. |
| `ERROR_SWALLOWED_EXCEPTION` | registry | on | A catch that discards the error. |
| `AI_SLOP_SHALLOW_CATCH` | registry | on | A catch whose body is one log or dump call. |
| `LINE_BUDGET_FILE`, `VIEW_MONOLITH`, `SYNTAX_PARSE_ERROR` | registry | on | Existing rules, now applied to `.php`. |
| `AI_SLOP_ECHO_COMMENT` | registry | dropped for `.php` | 7 of 12 labelled hits were real, under the bar, so its PHP findings are removed. |

Not built: a `get_option` credential-key rule and a read-site variant of `SECURITY_WP_UNSANITIZED_INPUT` (both under 80% precision on labels).

### Enabling a default-off rule

Name the rule in `.chemxrc` `rules`. The value `"on"` (or `true`) enables it and keeps the severities the engine emits. A severity value (`"low"` to `"critical"`) enables it and overwrites every severity, as it does for any rule. `"off"` disables a default-on rule.

```json
{ "rules": { "SECURITY_WP_UNPREPARED_SQL": "on", "SECURITY_WP_SSRF": "high" } }
```

Rules marked "off for PHP" are off only for PHP findings; they stay on for other languages.

## Annotations

A `chemx-allow` comment with a reason suppresses one rule:

```php
// chemx-allow: SECURITY_WP_PUBLIC_WRITE_ROUTE token checked in the callback
# chemx-allow: ERROR_SWALLOWED_EXCEPTION best-effort cleanup
/* chemx-allow: COMPLEXITY_CYCLOMATIC_HIGH generated dispatcher */
```

- The reason is mandatory.
- Only real comments count. A PHP 8 attribute `#[...]` is not a comment.
- File-level findings sit on line 1. An annotation in the file's leading comment block (a header annotation) also applies to line-1 findings.

## Per-plugin index and its caps

WordPress route, nonce and request-flow rules need callbacks that live in other classes and files. For a file in a WordPress root, chemx builds an index of that root:

- Files are listed from git (tracked and untracked) with `vendor/` and `node_modules/` skipped at any depth; outside git it walks the tree. The list refreshes when the git index changes or after 30 seconds.
- A cheap text prefilter runs on every file. Full parsing happens only for files that register hooks or routes, or declare a class a rule needs to resolve.
- Names resolve through namespaces, `use` imports, `extends` and traits. Callables resolve for strings, `[$this, 'm']`, `[self::class, 'm']`, `Class::class . '::m'`, closures and a few more forms. Dynamic names that cannot be resolved are not followed.
- Cap: 400 files or 8 MB of source per root. Above it the index holds only the audited file and the coverage reason is `wp-index-capped`. Cross-file findings can then be missing.
- Edit guardrails (`patch`, `write`) audit with cross-file analysis off: WordPress rules run on the one file and report nothing that needs another file.

## Coverage and inconclusive results

Every audited file gets a coverage record. For PHP:

| Kind | Reason | Meaning |
| :--- | :--- | :--- |
| `ast` | none | Parsed and all enabled passes ran. |
| `ast` | `wp-index-capped` | Parsed, but the plugin was over the index cap, so cross-file results may be missing. |
| `text-only` | `parser-unavailable` | `php-parser` could not be loaded; only text passes ran. |
| `text-only` | `minified` | The file looks minified and was not parsed. |
| `text-only` | `fast` | `--fast` skips parsing. |
| `parse-error` | the parser message | `SYNTAX_PARSE_ERROR` is reported and the AST passes did not run. |

A PHP result whose coverage kind is not `ast` is inconclusive: a low hazard count says nothing about the file. `chemx check`, the edit guardrails and `task done` say so, and `task done` refuses with `inconclusive-coverage`.

## Cross-file results and the gates

A finding for one file can depend on other files of the plugin. Findings whose evidence is in another file carry `crossFile: true`.

- `task done` re-audits the target at HEAD and compares per-rule counts. An unchanged PHP file is neutral.
- The absolute filter (any CRITICAL or HIGH finding refuses) skips `crossFile: true` findings; those are gated by delta only, because their cause may be in a file the task did not touch.
- When the target is a PHP file in a WordPress root, `task done` also re-audits each dependent file (files whose registrations or calls resolve into the target) at disk and at HEAD, and refuses when any rule count rises there. Only the target is pinned to HEAD; other files are read from disk.
- A PHP target of 1,000 lines or more carries a HIGH `LINE_BUDGET_FILE` finding and cannot pass the absolute filter. Moving code into a new file does not remove the finding from the plugin. Split first.
- Delta gating (`--staged-delta`, `--delta-base`, `verify --changed`) runs `git diff` in the current directory and does not recurse into submodules. From the monorepo root a plugin is only a gitlink, so PHP delta gating works only with the working directory inside the plugin repository.
- Only the kit has a chemx pre-commit hook. A plugin repository needs `chemx hook` installed to get PHP pre-commit coverage.
- The monorepo root `chemx audit` narrows to the workspace sources, like `verify`; `--dir=.` forces the full scan.

## Performance

Budgets are CPU time, measured on a loaded machine. They are targets checked by manual runs, not by `node --test`.

| Scope | Budget for PHP |
| :--- | :--- |
| A scan with no PHP | none; the parser is not loaded |
| One warm file up to 2,000 lines | at most 400 ms; corpus mean at most 30 ms |
| One file on the gate path, cold process | at most 1,500 ms, index at most 1,000 ms |
| Edit guardrail on one file, cold | at most 600 ms |
| One plugin of 26 PHP files, cold | at most 4,000 ms |
| 674-file corpus in one process | at most 25 s, heap growth at most 400 MB |

Measured basis: parser load 107 to 117 ms; idle parse mean 6.3 ms. Re-measure on your machine before relying on a number.

## What does not cover PHP

- Forge (`patterns --forge`, `blueprint`, `heal`) and `autofix` do not handle PHP.
- `--symbol` reads, `--blast-radius`, `backtrace` and `trace` have no PHP symbol support yet.
- Ratchets: a baseline recorded before PHP was audited lists the extensions it scanned. The first PHP scan adopts PHP counts as baseline once; JS regressions keep being gated.
- Triage of PHP findings is opt-in (`--triage` or `autoTriage`, capped at 50 tasks per run). Severity does not reduce the count: triage files one child per (rule, file) plus one parent per multi-file rule.
