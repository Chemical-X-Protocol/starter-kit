/** Kotlin language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'kotlin',
  name: 'Kotlin',
  version: 1,
  legacyId: 'jvm',
  files: { extensions: ['.kt'], tests: { names: ['*Test.kt', '*Tests.kt'], dirs: ['src/test'] } },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '.',
    strings: [{ open: '"', close: '"', escape: '\\' }],
    keywords: ['class', 'object', 'interface', 'fun', 'val', 'var', 'package', 'import']
  },
  parse: { grammar: 'kotlin', queries: 'kotlin', grammarStatus: 'experimental', errorPolicy: 'report' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: {
    exportRule: {
      kind: 'modifier',
      anyOf: ['public'],
      noneOf: ['private', 'internal', 'protected'],
      default: true
    }
  },
  imports: { resolver: 'jvm-package' },
  layout: {},
  ecosystems: ['gradle', 'maven'],
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
