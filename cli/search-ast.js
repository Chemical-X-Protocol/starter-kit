import path from 'node:path';
import { parse } from './babel-lazy.js';
import { isBabelParsable } from './languages.js';
import { parseSfc, isSfcFile, buildScriptOverlay } from './sfc/sfc-parse.js';
import { extractSfcProps, extractTemplateComponentImports, extractScriptSrcImports, componentNameFromPath } from './sfc/sfc-metadata.js';
import { extractModuleMetadata } from './search-ast-module.js';

const TIER_PATTERNS = [
  { tier: 'atom', test: (p, b) => p.includes('atoms/') || p.includes('/a-') || b.startsWith('a-') || /(?:^|[\\/])(?:Domain|Entities|Models)[\\/]/i.test(p) },
  { tier: 'molecule', test: (p, b) => p.includes('molecules/') || p.includes('/m-') || b.startsWith('m-') || /(?:^|[\\/])Features[\\/]/i.test(p) },
  { tier: 'organism', test: (p, b) => p.includes('organisms/') || p.includes('/o-') || b.startsWith('o-') || /(?:^|[\\/])(?:Services|Handlers|Commands|Queries)[\\/]/i.test(p) },
  { tier: 'template', test: (p, b) => p.includes('templates/') || p.includes('/t-') || b.startsWith('t-') },
  { tier: 'view', test: (p, b) => p.includes('/views/') || p.includes('/pages/') || p.includes('/routes/') || /(?:^|[\\/])(?:Controllers|Endpoints)[\\/]/i.test(p) || /View\.[tj]sx?$/.test(b) || /Controller\.cs$/.test(b) },
  { tier: 'hook', test: (p, b) => p.includes('/hooks/') || p.includes('/composables/') || /^use[A-Z]/.test(b) },
  { tier: 'type', test: (p, b) => b.endsWith('.d.ts') || p.includes('/types/') || /(?:^|[\\/])(?:Dtos|Contracts)[\\/]/i.test(p) }
];

export const resolveArchitectureTier = (relativePath) => {
  const baseName = path.basename(relativePath);
  for (const { tier, test } of TIER_PATTERNS) {
    const isMatch = Boolean(test(relativePath, baseName));
    if (isMatch) return tier;
  }
  return 'utility';
};

const CPP_NON_DECLARATION_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'else', 'do', 'throw', 'new', 'delete'
]);

// Declaration keywords are never symbol names. Guards cross-language regex overlap,
// e.g. the Rust `enum` pattern matching C++ `enum class Codec` and capturing `class`.
const RESERVED_SYMBOL_NAMES = new Set([
  'class', 'struct', 'enum', 'union', 'interface', 'object', 'fun', 'trait', 'impl', 'mod',
  'namespace', 'typename', 'template', 'public', 'private', 'protected', 'static', 'const'
]);

const JS_FAMILY_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;

const extractRegexFallback = (content, filePath = '') => {
  const symbols = [];
  const imports = [];
  const hooks = new Set();
  const props = [];
  // A JS/TS/SFC file that failed to parse only gets the JS patterns; the
  // Python/Go/C++/Rust/Kotlin patterns would invent symbols from JS text.
  const isJsFamily = JS_FAMILY_FILE.test(filePath);

  const exportMatches = content.matchAll(/export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g);
  for (const m of exportMatches) {
    symbols.push({ name: m[1], kind: 'symbol', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const polyglotSource = isJsFamily ? '' : content;
  const csMatches = polyglotSource.matchAll(/(?:public|internal|protected)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|record|interface|struct|enum)\s+([A-Za-z0-9_]+)/g);
  for (const m of csMatches) {
    symbols.push({ name: m[1], kind: 'class', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const pyMatches = polyglotSource.matchAll(/(?:def|class)\s+([A-Za-z0-9_]+)/g);
  for (const m of pyMatches) {
    symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const goMatches = polyglotSource.matchAll(/(?:func(?:\s*\([^)]*\))?\s+|type\s+)([A-Za-z0-9_]+)/g);
  for (const m of goMatches) {
    symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const cppTypeMatches = polyglotSource.matchAll(/\b(?:class|struct|union|enum(?:\s+class)?)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const m of cppTypeMatches) {
    const isReservedName = RESERVED_SYMBOL_NAMES.has(m[1]);
    if (!isReservedName) {
      symbols.push({ name: m[1], kind: 'class', isExport: true, startLine: 1, endLine: 1, signature: '' });
    }
  }

  const cppQualifiedMatches = polyglotSource.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\s*::\s*([A-Za-z_~][A-Za-z0-9_]*)\s*\(/g);
  for (const m of cppQualifiedMatches) {
    symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const cppDeclMatches = polyglotSource.matchAll(/^[ \t]*(?:[A-Za-z_][A-Za-z0-9_:<>,*& \t]*?)\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:const\s*)?[;{]/gm);
  for (const m of cppDeclMatches) {
    const isNonDeclarationKeyword = CPP_NON_DECLARATION_KEYWORDS.has(m[1]);
    if (!isNonDeclarationKeyword) {
      symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
    }
  }

  const rustMatches = polyglotSource.matchAll(/\b(?:pub\s+)?(?:struct|enum|trait|impl|mod|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const m of rustMatches) {
    const isReservedName = RESERVED_SYMBOL_NAMES.has(m[1]);
    if (!isReservedName) {
      symbols.push({ name: m[1], kind: 'symbol', isExport: true, startLine: 1, endLine: 1, signature: '' });
    }
  }

  const kotlinMatches = polyglotSource.matchAll(/\b(?:data\s+|sealed\s+|open\s+|abstract\s+|inner\s+)?(?:class|object|interface|fun)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const m of kotlinMatches) {
    const isReservedName = RESERVED_SYMBOL_NAMES.has(m[1]);
    if (!isReservedName) {
      symbols.push({ name: m[1], kind: 'symbol', isExport: true, startLine: 1, endLine: 1, signature: '' });
    }
  }

  const cppIncludes = polyglotSource.matchAll(/#include\s*[<"]([^>"]+)[>"]/g);
  for (const m of cppIncludes) {
    imports.push({ importedSymbol: '*', sourceModule: m[1], line: 1 });
  }

  const rustUses = polyglotSource.matchAll(/\buse\s+([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+)/g);
  for (const m of rustUses) {
    imports.push({ importedSymbol: '*', sourceModule: m[1], line: 1 });
  }

  const csImports = polyglotSource.matchAll(/using\s+([A-Za-z0-9_.]+);/g);
  for (const m of csImports) {
    imports.push({ importedSymbol: '*', sourceModule: m[1], line: 1 });
  }

  const pyImports = polyglotSource.matchAll(/(?:import\s+([A-Za-z0-9_.]+)|from\s+([A-Za-z0-9_.]+)\s+import)/g);
  for (const m of pyImports) {
    const mod = m[1] || m[2];
    imports.push({ importedSymbol: '*', sourceModule: mod, line: 1 });
  }

  const hookMatches = content.matchAll(/\b(use[A-Z0-9][A-Za-z0-9_$]*)\b/g);
  for (const h of hookMatches) {
    hooks.add(h[1]);
  }

  const propMatches = content.matchAll(/(?:readonly\s+)?([A-Za-z0-9_$]+)\s*\??\s*:\s*([^;,\n]+)[;,]/g);
  for (const p of propMatches) {
    const hasPropRoom = props.length < 20;
    const isNamedProp = !['string', 'number', 'boolean', 'void'].includes(p[1]);
    const shouldAddProp = hasPropRoom && isNamedProp;
    if (shouldAddProp) {
      props.push({ name: p[1], type: p[2].trim() });
    }
  }

  const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+)|\*\s+as\s+([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g);
  for (const m of importMatches) {
    const sourceModule = m[4];
    const hasNamedImports = Boolean(m[1]);
    if (hasNamedImports) {
      for (const s of m[1].split(',')) {
        const trimmed = s.trim().split(/\s+as\s+/)[0].trim();
        if (trimmed) imports.push({ importedSymbol: trimmed, sourceModule, line: 1 });
      }
    } else if (m[2]) {
      imports.push({ importedSymbol: 'default', sourceModule, line: 1 });
    } else if (m[3]) {
      imports.push({ importedSymbol: '*', sourceModule, line: 1 });
    }
  }

  return { symbols, props, hooks: Array.from(hooks), imports };
};

const parseModule = (code) => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

const parseWithBlockFallback = (code, sfc, content) => {
  try {
    return parseModule(code);
  } catch (err) {
    const inlineScripts = sfc ? sfc.scripts.filter((s) => !s.src) : [];
    const canSplit = inlineScripts.length > 1;
    if (!canSplit) throw err;
    const programs = inlineScripts.map((block) => parseModule(buildScriptOverlay(content, [block])));
    return { program: { body: programs.flatMap((ast) => ast.program.body) } };
  }
};

const uniqueByName = (items) => [...new Map(items.map((item) => [item.name, item])).values()];

const extractSfcMetadata = (base, sfc, ast, filePath, contentLines) => {
  const localImportNames = new Set(base.imports.map((imp) => imp.importedSymbol));
  for (const stmt of ast.program.body) {
    const isImport = stmt.type === 'ImportDeclaration';
    if (isImport) for (const spec of stmt.specifiers || []) localImportNames.add(spec.local.name);
  }
  const componentSymbol = { name: componentNameFromPath(filePath), kind: 'component', isExport: true, startLine: 1, endLine: contentLines.length, signature: '' };
  return {
    symbols: [componentSymbol, ...base.symbols],
    props: uniqueByName([...extractSfcProps(ast.program), ...base.props]),
    hooks: base.hooks,
    imports: [...base.imports, ...extractScriptSrcImports(sfc), ...extractTemplateComponentImports(sfc, localImportNames)]
  };
};

export const extractAstMetadata = (content, filePath) => {
  if (!isBabelParsable(filePath)) {
    return extractRegexFallback(content, filePath);
  }
  const contentLines = content.split('\n');
  const sfc = isSfcFile(filePath) ? parseSfc(content, filePath) : null;
  const code = sfc ? sfc.scriptOverlay : content;
  try {
    const ast = parseWithBlockFallback(code, sfc, content);
    const base = extractModuleMetadata(ast, contentLines, filePath);
    return sfc ? extractSfcMetadata(base, sfc, ast, filePath, contentLines) : base;
  } catch {
    return extractRegexFallback(content, filePath);
  }
};
