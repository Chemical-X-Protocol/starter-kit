/** PHP language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'php',
  name: 'PHP',
  version: 1,
  files: {
    extensions: ['.php', '.phtml'],
    vendorDirs: [{ name: 'vendor', when: 'project-root' }],
    tests: { names: ['*Test.php'], dirs: ['tests'] }
  },
  syntax: {
    lineComment: ['//', '#'],
    blockComment: [{ open: '/*', close: '*/' }],
    strings: [{ open: '"', close: '"', escape: '\\' }, { open: '\'', close: '\'', escape: '\\' }],
    blockStyle: 'brace',
    keywords: [
      'function',
      'class',
      'interface',
      'trait',
      'namespace',
      'use',
      'public',
      'private',
      'protected'
    ],
    qualifier: '\\'
  },
  parse: { grammar: 'php', queries: 'php', grammarStatus: 'vetted', errorPolicy: 'report' },
  engines: {
    index: 'php-parser',
    outline: 'php-parser',
    symbol: 'php-parser',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'off', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'all' } },
  imports: { resolver: 'php-psr4' },
  layout: {},
  ecosystems: ['php-harness', 'composer'],
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
