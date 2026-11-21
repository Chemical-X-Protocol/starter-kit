/** C# / .NET language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'csharp',
  name: 'C# / .NET',
  version: 1,
  files: {
    extensions: ['.cs'],
    vendorDirs: [{ name: 'obj', when: 'project-root' }],
    generated: ['*.g.cs', '*.Designer.cs'],
    tests: { names: ['*Test.cs', '*Tests.cs'] }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/' }],
    blockStyle: 'brace',
    qualifier: '.',
    strings: [
      { open: '"', close: '"', escape: '\\' },
      { open: '@"', close: '"', escape: null, raw: true, multiline: true }
    ],
    keywords: [
      'class',
      'struct',
      'interface',
      'enum',
      'namespace',
      'using',
      'public',
      'private',
      'internal',
      'static'
    ]
  },
  parse: { grammar: 'c_sharp', queries: 'csharp', grammarStatus: 'vetted', errorPolicy: 'report' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'csharp-heuristic',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'modifier', anyOf: ['public', 'internal'], default: false } },
  imports: { resolver: 'dotnet-namespace' },
  layout: {},
  ecosystems: ['dotnet'],
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
