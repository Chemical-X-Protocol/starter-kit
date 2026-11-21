/** JavaScript language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'javascript',
  name: 'JavaScript',
  version: 1,
  files: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    vendorDirs: [{ name: 'node_modules', when: 'always' }],
    tests: {
      names: ['*.test.js', '*.spec.js', '*.test.jsx', '*.spec.jsx', '*.test.mjs', '*.spec.mjs'],
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
  parse: {
    grammar: 'javascript',
    queries: 'javascript',
    grammarStatus: 'vetted',
    errorPolicy: 'report'
  },
  engines: {
    index: 'babel',
    outline: 'babel',
    symbol: 'babel',
    logic: 'babel',
    audit: 'babel',
    editGate: 'babel'
  },
  stages: { source: 'on', index: 'on', outline: 'on', imports: 'on' },
  symbols: { exportRule: { kind: 'capture' } },
  imports: { resolver: 'js' },
  layout: {},
  ecosystems: ['npm'],
  audit: {
    analysisRevision: 1,
    passes: ['text', 'structure', 'complexity', 'errors', 'security', 'logging', 'tests', 'env']
  },
  notApplicable: {}
});
