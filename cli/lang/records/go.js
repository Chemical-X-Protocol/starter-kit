/** Go language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'go',
  name: 'Go',
  version: 1,
  files: {
    extensions: ['.go'],
    vendorDirs: [{ name: 'vendor', when: 'project-root' }],
    tests: { names: ['*_test.go'] }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '.',
    strings: [
      { open: '"', close: '"', escape: '\\' },
      { open: '`', close: '`', escape: null, raw: true, multiline: true }
    ],
    keywords: ['func', 'type', 'struct', 'interface', 'package', 'import', 'var', 'const']
  },
  parse: { grammar: 'go', queries: 'go', grammarStatus: 'vetted', errorPolicy: 'coverage-only' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'name-capitalized' } },
  imports: { resolver: 'go-module' },
  layout: {},
  ecosystems: ['go'],
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
