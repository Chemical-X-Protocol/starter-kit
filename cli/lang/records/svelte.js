/** Svelte language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'svelte',
  name: 'Svelte',
  version: 1,
  files: {
    extensions: ['.svelte'],
    vendorDirs: [{ name: 'node_modules', when: 'always' }],
    tests: {
      names: ['*.test.js', '*.spec.js', '*.test.ts', '*.spec.ts'],
      dirs: ['tests', '__tests__']
    }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '.',
    strings: [
      { open: '"', close: '"', escape: '\\' },
      { open: '\'', close: '\'', escape: '\\' },
      { open: '`', close: '`', escape: '\\', multiline: true }
    ],
    keywords: ['function', 'class', 'const', 'let', 'var', 'import', 'export', 'return', 'async', 'await']
  },
  parse: { grammarStatus: 'none', errorPolicy: 'report' },
  engines: {
    index: 'sfc',
    outline: 'sfc',
    symbol: 'sfc',
    logic: 'sfc',
    audit: 'babel',
    editGate: 'babel'
  },
  stages: { source: 'on', index: 'on', outline: 'on', imports: 'on' },
  symbols: { exportRule: { kind: 'capture' } },
  imports: { resolver: 'js' },
  layout: { viewMarkup: true },
  ecosystems: ['npm'],
  audit: {
    analysisRevision: 1,
    passes: ['text', 'structure', 'complexity', 'errors', 'security', 'logging', 'tests', 'env']
  },
  notApplicable: {}
});
