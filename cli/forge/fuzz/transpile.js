// Source -> CommonJS-shaped JS for the fuzz sandbox (#2596). Plain JS without import/export syntax is
// left as written: module code gets a "use strict" prologue and loses its `export` keywords (the
// sandbox appends `exports.__fuzzHost = host`), script code runs as is (sloppy unless it says
// otherwise). Anything with TS, JSX or import/export-default syntax goes through the TypeScript
// compiler (a devDependency, loaded on first use): target ESNext keeps class fields, private members
// and async code as written; JSX becomes __h(type, props, ...children) calls the harness records.
// `import.meta` is rewritten to the sandbox's per-module __importMeta. Results are cached by text.
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const cache = new Map();
const TS_FILE = /\.(ts|tsx|jsx|mts|cts)$/;
const NEEDS_COMPILER = /\bimport\b|\bexport\s+(default\b|\{|\*)/;
const EXPORT_KEYWORD = /(^|[\s;{}])export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b|enum\b)/g;

let typescript = null;
const loadTypescript = () => {
  typescript = typescript ?? requireFromHere('typescript');
  return typescript;
};

const fileNameFor = (relativePath) => {
  const isTsx = /\.(tsx|jsx)$/.test(relativePath) || relativePath.endsWith('.vue');
  if (isTsx) return relativePath.endsWith('.jsx') ? 'module.jsx' : 'module.tsx';
  return /\.(ts|mts|cts)$/.test(relativePath) ? 'module.ts' : 'module.js';
};

const viaCompiler = (relativePath, code) => {
  const ts = loadTypescript();
  const source = code.replace(/\bimport\.meta\b/g, '__importMeta');
  const { outputText } = ts.transpileModule(source, {
    fileName: fileNameFor(relativePath),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.React,
      jsxFactory: '__h',
      jsxFragmentFactory: '__Fragment',
      esModuleInterop: true,
      allowJs: true,
      useDefineForClassFields: true
    },
    reportDiagnostics: false
  });
  return outputText;
};

const plainModule = (code) => `"use strict";\n${code.replace(EXPORT_KEYWORD, '$1')}`;

/** Compiles one file of a pair side. options.mode: 'module' (ESM, strict) or 'script' (CommonJS). */
export const compileModule = (relativePath, code, { mode = 'module' } = {}) => {
  const key = `${mode}|${relativePath}|${code}`;
  const isCached = cache.has(key);
  if (isCached) return cache.get(key);
  const needsCompiler = TS_FILE.test(relativePath) || NEEDS_COMPILER.test(code);
  const isScript = mode === 'script';
  const plain = isScript ? code : plainModule(code);
  const compiled = needsCompiler ? viaCompiler(relativePath, code) : plain;
  cache.set(key, compiled);
  return compiled;
};
