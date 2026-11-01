/** Python language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'python',
  name: 'Python',
  version: 1,
  files: {
    extensions: ['.py'],
    vendorDirs: [{ name: 'venv', when: 'always' }, { name: '__pycache__', when: 'always' }],
    tests: { names: ['test_*.py', '*_test.py'], dirs: ['tests'] }
  },
  syntax: {
    lineComment: ['#'],
    blockComment: [],
    docString: [{ open: '"""', close: '"""' }],
    strings: [
      { open: '"', close: '"', escape: '\\' },
      { open: '\'', close: '\'', escape: '\\' },
      { open: '"""', close: '"""', escape: '\\', multiline: true }
    ],
    blockStyle: 'indent',
    blockOpeners: [':'],
    keywords: ['def', 'class', 'import', 'from', 'return', 'async', 'await'],
    qualifier: '.'
  },
  parse: { grammar: 'python', queries: 'python', grammarStatus: 'vetted', errorPolicy: 'report' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'name-not-prefix', prefix: '_' } },
  imports: { resolver: 'python' },
  layout: {},
  ecosystems: ['python'],
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
