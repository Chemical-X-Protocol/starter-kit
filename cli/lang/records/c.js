/** C language record (header sniffing per spec 4.3); see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'c',
  name: 'C',
  version: 1,
  legacyId: 'cpp',
  files: {
    extensions: ['.c', '.h'],
    ambiguous: {
      '.h': {
        markers: [
          { re: '#include\\s*<(stdio|stdlib|string|stdint)\\.h>', weight: 1 },
          { re: '\\btypedef\\s+struct\\b', weight: 1 }
        ],
        minScore: 1
      }
    },
    tests: { names: ['test_*.c', '*_test.c'], dirs: ['tests'] }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '.',
    strings: [{ open: '"', close: '"', escape: '\\' }, { open: '\'', close: '\'', escape: '\\' }],
    keywords: ['struct', 'enum', 'union', 'typedef', 'static', 'extern', 'void', 'return']
  },
  parse: { grammar: 'c', queries: 'c', grammarStatus: 'vetted', errorPolicy: 'coverage-only' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'top-level-only' } },
  imports: { resolver: 'c-include' },
  layout: {},
  ecosystems: ['cmake', 'make'],
  audit: { analysisRevision: 1, passes: ['text'] },
  notApplicable: {
    forge: 'JS framework feature; not available outside the JS family',
    heal: 'JS framework feature; not available outside the JS family',
    explode: 'JS framework feature; not available outside the JS family',
    generate: 'JS framework feature; not available outside the JS family',
    capsule: 'JS framework feature; not available outside the JS family',
    scaffold: 'JS framework feature; not available outside the JS family',
    lanes: 'JS framework feature; not available outside the JS family',
    mutators: 'JS framework feature; not available outside the JS family'
  }
});
