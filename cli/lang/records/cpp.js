/** C++ language record (header sniffing per spec 4.3); see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'cpp',
  name: 'C++',
  version: 1,
  legacyId: 'cpp',
  files: {
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh', '.inl', '.h'],
    ambiguous: {
      '.h': {
        markers: [
          { re: '\\bnamespace\\s+\\w+', weight: 1 },
          { re: '\\btemplate\\s*<', weight: 1 },
          { re: '\\bclass\\s+\\w+\\s*[:{]', weight: 1 },
          { re: '#include\\s*<(iostream|vector|string|memory)>', weight: 1 }
        ],
        minScore: 1,
        tieBreak: [{ when: { sibling: '*.cpp' }, pick: 'cpp' }]
      }
    },
    tests: { names: ['test_*.cpp', '*_test.cpp', '*_test.cc'], dirs: ['tests'] }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '::',
    strings: [{ open: '"', close: '"', escape: '\\' }, { open: '\'', close: '\'', escape: '\\' }],
    keywords: [
      'struct',
      'enum',
      'union',
      'typedef',
      'static',
      'extern',
      'void',
      'return',
      'class',
      'namespace',
      'template',
      'public',
      'private'
    ]
  },
  parse: {
    grammar: 'cpp',
    queries: 'cpp',
    inheritQueries: ['c'],
    grammarStatus: 'vetted',
    errorPolicy: 'coverage-only'
  },
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
