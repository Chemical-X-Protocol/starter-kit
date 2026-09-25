/**
 * Chemical X Language Registry
 * Central authority for language classification, file extension routing, and parser selection.
 */
import path from 'node:path';

export const LANGUAGE_DEFINITIONS = {
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    extensions: new Set(['.ts', '.tsx']),
    parser: 'babel',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    extensions: new Set(['.js', '.jsx', '.mjs', '.cjs']),
    parser: 'babel',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  vue: {
    id: 'vue',
    name: 'Vue SFC',
    extensions: new Set(['.vue']),
    parser: 'babel',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  svelte: {
    id: 'svelte',
    name: 'Svelte',
    extensions: new Set(['.svelte']),
    parser: 'babel',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  csharp: {
    id: 'csharp',
    name: 'C# / .NET',
    extensions: new Set(['.cs']),
    parser: 'csharp',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  python: {
    id: 'python',
    name: 'Python',
    extensions: new Set(['.py']),
    parser: 'python',
    commentPrefix: '#',
    blockComment: { start: '"""', end: '"""' }
  },
  go: {
    id: 'go',
    name: 'Go',
    extensions: new Set(['.go']),
    parser: 'go',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    extensions: new Set(['.rs']),
    parser: 'rust',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  },
  jvm: {
    id: 'jvm',
    name: 'Java / Kotlin',
    extensions: new Set(['.java', '.kt']),
    parser: 'jvm',
    commentPrefix: '//',
    blockComment: { start: '/*', end: '*/' }
  }
};

const ALL_EXTENSIONS = new Set(
  Object.values(LANGUAGE_DEFINITIONS).flatMap((lang) => Array.from(lang.extensions))
);

const EXCLUDED_NAME_PATTERNS = ['.min.'];

export const getLanguageByExtension = (ext) => {
  const normalized = ext.toLowerCase();
  for (const lang of Object.values(LANGUAGE_DEFINITIONS)) {
    if (lang.extensions.has(normalized)) return lang;
  }
  return null;
};

export const getLanguageForFile = (filePath) => {
  const ext = path.extname(filePath);
  return getLanguageByExtension(ext);
};

export const isSourceFile = (name, options = {}) => {
  const { includeTests = true } = options;
  const ext = path.extname(name).toLowerCase();
  if (!ALL_EXTENSIONS.has(ext)) return false;
  if (name.endsWith('.d.ts')) return false;

  if (EXCLUDED_NAME_PATTERNS.some((pat) => name.includes(pat))) {
    return false;
  }

  if (!includeTests) {
    const isTest = name.includes('.test.') || name.includes('.spec.') || name.endsWith('Test.cs') || name.endsWith('Tests.cs');
    if (isTest) return false;
  }

  return true;
};

export const isBabelParsable = (filePath) => {
  const lang = getLanguageForFile(filePath);
  return lang?.parser === 'babel';
};
