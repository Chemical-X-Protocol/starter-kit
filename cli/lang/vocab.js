/**
 * Closed vocabularies of the language-adapter contract (design spec 4.16). Each vocabulary has
 * exactly one registration point, here: adding a name is one line, and the code behind a name is
 * a module found by convention. Pure data, no imports, safe for the guard's import closure.
 */

const list = (...names) => Object.freeze(names);

export const SYMBOL_KINDS = list(
  'module', 'namespace', 'class', 'struct', 'interface', 'trait', 'protocol', 'enum', 'record', 'union',
  'type', 'function', 'method', 'constructor', 'property', 'field', 'const', 'variable', 'macro',
  'component', 'test', 'resource', 'table', 'view', 'procedure',
  // container-only kinds: they group members but are not indexed as definitions
  'impl', 'extension', 'block'
);

export const VISIBILITIES = list('public', 'private', 'protected', 'internal', 'package', 'fileprivate', 'open');
export const IMPORT_KINDS = list('import', 'from', 'require', 'include', 'use', 'using', 'source', 'module', 'dynamic', 'reexport');

/** Capture names per kit-owned query file (spec 4.5). `@definition.*` and `@container.*` expand from the kinds. */
export const CAPTURES = Object.freeze({
  tags: list(
    ...SYMBOL_KINDS.filter((k) => !['impl', 'extension', 'block'].includes(k)).map((k) => `@definition.${k}`),
    '@container.impl', '@container.extension', '@container.block',
    '@name', '@body', '@doc', '@export', '@visibility', '@modifier', '@reference.type', '@entry'
  ),
  imports: list(
    '@import', '@import.source', '@import.source.system', '@import.name', '@import.alias', '@import.wildcard',
    '@import.mod', '@import.type-only', '@import.dynamic'
  ),
  calls: list('@call', '@call.name', '@call.receiver'),
  syntax: list('@comment', '@comment.doc', '@string'),
  audit: list(
    '@scope.function', '@branch', '@logic', '@nest', '@ternary', '@catch', '@catch.body', '@catch.swallow',
    '@exec', '@log', '@flow.return', '@flow.throw', '@flow.loop'
  )
});

/** Predicates that `#set!` may carry in query files. */
export const QUERY_PROPERTIES = list('chemx.kind', 'chemx.skip', 'chemx.importKind');

export const ENGINES = list('babel', 'sfc', 'php-parser', 'csharp-heuristic', 'tree-sitter', 'regex', 'legacy-polyglot', 'text');
export const ENGINE_SLOTS = list('index', 'outline', 'symbol', 'logic', 'audit', 'editGate');
export const CAPABILITIES = list('source', 'index', 'outline', 'imports', 'resolve', 'editGate', 'audit', 'guard');
export const STAGES = list('off', 'text', 'shadow', 'on');

export const BLOCK_STYLES = list('brace', 'indent', 'end-keyword', 'paren', 'none');
export const QUALIFIERS = list('.', '::', '\\');
export const GRAMMAR_STATUSES = list('vetted', 'experimental', 'none');
export const ERROR_POLICIES = list('report', 'coverage-only');
export const GRAMMAR_TIERS = list('core', 'extended', 'experimental');
export const LEGACY_IDS = list('jvm', 'cpp');
export const VENDOR_WHEN = list('always', 'project-root');
export const LAYOUT_TIERS = list(
  'primitive', 'prefab', 'construct', 'blueprint', 'level', 'atom', 'molecule', 'organism', 'template', 'page'
);

export const EXPORT_RULE_KINDS = list('all', 'top-level-only', 'capture', 'name-not-prefix', 'name-capitalized', 'modifier');

export const RESOLVER_NAMES = list(
  'js', 'path-probe', 'python', 'c-include', 'go-module', 'rust-crate', 'jvm-package', 'dotnet-namespace', 'php-psr4'
);

/** Audit pass families a record may enable; the analyzer behind each is chosen by `engines.audit`. */
export const PASS_NAMES = list('text', 'structure', 'complexity', 'errors', 'security', 'logging', 'tests', 'env');

/** Features a language can mark not applicable, with a reason shown to the user (spec 4.15). */
export const NA_FEATURES = list(
  'forge', 'heal', 'explode', 'generate', 'capsule', 'scaffold', 'lanes', 'template', 'autofix', 'mutators'
);

// Hook names: each resolves to a module by convention (spec 4.16); the name check happens here.
export const REGION_HOOKS = list('regions-ipynb', 'regions-rmd', 'regions-jinja-sql', 'regions-tsql-batches');
export const IMPORT_NORMALIZERS = list('rust-use-tree', 'dbt-refs');
export const IMPLICIT_EDGE_HOOKS = list(
  'same-package-decl', 'same-namespace', 'same-module-target', 'header-impl', 'autoload-constant',
  'terraform-dir', 'conftest-fixture', 'declared-name'
);
export const ANALYZER_HOOKS = list();
export const PLANNER_HOOKS = list('npm-legacy', 'php-harness');
export const FORMAT_HOOKS = list('json-diagnostics');

// Toolchain ecosystem vocabularies (spec 4.11).
export const TARGET_MODES = list('file', 'files', 'dir', 'package', 'module', 'project', 'none');
export const WORKSPACE_FORMATS = list('go-work', 'cargo-toml', 'gradle-settings', 'sln', 'maven-modules', 'pnpm', 'npm', 'uv');
export const MANIFEST_FORMATS = list('json', 'toml-lite', 'xml-lite', 'go-mod', 'line');
export const PARSER_IDS = list(
  'node-legacy', 'junit', 'trx', 'tap', 'go-test-json', 'dart-json', 'json-diagnostics',
  'gcc', 'msbuild', 'javac-maven', 'kotlinc', 'rustc-short', 'mypy', 'pyright', 'ruff', 'cargo-test'
);
