/**
 * Language adapter contract (design spec 4.2 and 4.5). A language is one plain-data record;
 * `schema.js` enforces this shape at runtime and `vocab.js` holds every closed vocabulary.
 */

/** Matches /^[a-z][a-z0-9]*$/; not a closed union, a new language adds a record, not a type. */
export type LanguageId = string;
/** A glob source string. */
export type Glob = string;
/** A regular expression source string; records never hold RegExp objects. */
export type RegexSource = string;
/** A name resolved to a module by convention (spec 4.16), checked against vocab.js. */
export type HookName = string;

export type SymbolKind =
  | 'module' | 'namespace' | 'class' | 'struct' | 'interface' | 'trait' | 'protocol' | 'enum' | 'record' | 'union'
  | 'type' | 'function' | 'method' | 'constructor' | 'property' | 'field' | 'const' | 'variable' | 'macro'
  | 'component' | 'test' | 'resource' | 'table' | 'view' | 'procedure'
  | 'impl' | 'extension' | 'block';
export type Visibility = 'public' | 'private' | 'protected' | 'internal' | 'package' | 'fileprivate' | 'open';
export type ImportKind = 'import' | 'from' | 'require' | 'include' | 'use' | 'using' | 'source' | 'module' | 'dynamic' | 'reexport';
export type Engine = 'babel' | 'sfc' | 'php-parser' | 'csharp-heuristic' | 'tree-sitter' | 'regex' | 'legacy-polyglot' | 'text';
export type EngineSlot = 'index' | 'outline' | 'symbol' | 'logic' | 'audit' | 'editGate';
export type Capability = 'source' | 'index' | 'outline' | 'imports' | 'resolve' | 'editGate' | 'audit' | 'guard';
export type Stage = 'off' | 'text' | 'shadow' | 'on';
export type BlockStyle = 'brace' | 'indent' | 'end-keyword' | 'paren' | 'none';
export type Tier = 'primitive' | 'prefab' | 'construct' | 'blueprint' | 'level' | 'atom' | 'molecule' | 'organism' | 'template' | 'page';
export type PassName = 'text' | 'structure' | 'complexity' | 'errors' | 'security' | 'logging' | 'tests' | 'env';
export type NaFeature = 'forge' | 'heal' | 'explode' | 'generate' | 'capsule' | 'scaffold' | 'lanes' | 'template' | 'autofix' | 'mutators';
export type ResolverName =
  | 'js' | 'path-probe' | 'python' | 'c-include' | 'go-module' | 'rust-crate' | 'jvm-package' | 'dotnet-namespace' | 'php-psr4';

/** Free-form resolver options: plain JSON-like data only. */
export type ResolverOptions = { [key: string]: unknown };

export interface TieBreak {
  when: { sibling?: Glob; ancestor?: Glob };
  /** The language id chosen when the condition holds. */
  pick: LanguageId;
}

export type ExportRule =
  | { kind: 'all' } | { kind: 'top-level-only' } | { kind: 'capture' }
  | { kind: 'name-not-prefix'; prefix: string } | { kind: 'name-capitalized' }
  | { kind: 'modifier'; anyOf: string[]; noneOf?: string[]; default: boolean };

export interface LanguageRecord {
  id: LanguageId;
  name: string;
  /** Bumps when the record or its queries change meaning. */
  version: number;
  /** Facade id until the coverage bucket switch. */
  legacyId?: 'jvm' | 'cpp';
  /** Coverage and ratchet bucket key. */
  reportAs?: string;
  files: {
    extensions: string[];
    filenames?: string[];
    paths?: Glob[];
    shebangs?: string[];
    ambiguous?: Record<string, { markers: { re: RegexSource; weight: number }[]; minScore: number; tieBreak?: TieBreak[] }>;
    exclude?: Glob[];
    declaration?: Glob[];
    generated?: Glob[];
    generatedMarkers?: RegexSource[];
    vendorDirs?: { name: string; when: 'always' | 'project-root' | { sibling: Glob } }[];
    tests: { names: Glob[]; dirs?: string[]; contentMarkers?: RegexSource[] };
    /** Embedded-language splitter. */
    regions?: HookName;
    dialects?: { default: string; byExtension?: Record<string, string> };
  };
  syntax: {
    lineComment: string[];
    blockComment: { open: string; close: string; nests?: boolean }[];
    docString?: { open: string; close: string }[];
    strings: { open: string; close: string; escape: string | null; raw?: boolean; multiline?: boolean }[];
    blockStyle: BlockStyle;
    blockOpeners?: string[];
    endKeywords?: string[];
    keywords: string[];
    qualifier: '.' | '::' | '\\';
  };
  parse: {
    grammar?: string | Record<string, string>;
    queries?: string;
    inheritQueries?: string[];
    grammarStatus: 'vetted' | 'experimental' | 'none';
    errorPolicy: 'report' | 'coverage-only';
    maxBytes?: number;
    timeBudgetMs?: number;
  };
  engines: Record<EngineSlot, Engine>;
  stages: Partial<Record<Capability, Stage>>;
  /** Own-language regex module in cli/lang/fallback/. */
  fallback?: string;
  symbols: {
    exportRule: ExportRule;
    memberKinds?: Partial<Record<SymbolKind, SymbolKind>>;
    constructorRule?: { names?: string[]; nameEqualsContainer?: boolean };
    indexKinds?: SymbolKind[];
  };
  imports: { resolver: ResolverName; options?: ResolverOptions; normalize?: HookName; implicitEdges?: HookName[] };
  layout: { tiers?: { glob: Glob; tier: Tier }[]; entryPoints?: Glob[]; viewMarkup?: boolean };
  ecosystems: string[];
  audit: {
    analysisRevision: number;
    passes: PassName[];
    analyzer?: HookName;
    defaultOff?: string[];
    droppedTextRules?: string[];
    envAccess?: RegexSource[];
    fakeGreen?: RegexSource[];
    deltaGate?: boolean;
  };
  /** Feature to the reason shown to the user. */
  notApplicable: Partial<Record<NaFeature, string>>;
}

export interface SymbolRow {
  name: string; kind: SymbolKind; startLine: number; endLine: number; startColumn: number;
  signature: string; isExport: boolean; visibility: Visibility | null; container: string | null;
  qualifiedName: string; depth: number; isMember: boolean; docStartLine: number | null;
  language: string; engine: Engine; confidence: 'ast' | 'heuristic';
}

export interface ImportRow {
  specifier: string; kind: ImportKind; names: string[]; alias: string | null;
  line: number; isTypeOnly: boolean; confidence: 'ast' | 'heuristic';
}

export interface Extraction {
  language: string; engine: Engine;
  status: 'ok' | 'partial' | 'error' | 'minified' | 'skipped' | 'unavailable' | 'heuristic' | 'text';
  reason: string | null; errorCount: number;
  firstError: { line: number; column: number; message: string } | null;
  symbols: SymbolRow[]; imports: ImportRow[];
  /** `${id}@${version}:${engine}:${grammarSha8|'-'}:${stage}` */
  fingerprint: string;
}

export interface SchemaError { path: string; message: string }
export interface SchemaResult { ok: boolean; errors: SchemaError[] }
