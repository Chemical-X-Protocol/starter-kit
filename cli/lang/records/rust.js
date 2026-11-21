/** Rust language record; see design spec 4.2 and 5. */
export default Object.freeze({
  id: 'rust',
  name: 'Rust',
  version: 1,
  files: {
    extensions: ['.rs'],
    vendorDirs: [{ name: 'target', when: 'project-root' }],
    tests: { names: ['*_test.rs'], dirs: ['tests'] }
  },
  syntax: {
    lineComment: ['//'],
    blockComment: [{ open: '/*', close: '*/', nests: true }],
    strings: [
      { open: '"', close: '"', escape: '\\' },
      { open: 'r#"', close: '"#', escape: null, raw: true, multiline: true }
    ],
    blockStyle: 'brace',
    keywords: ['fn', 'struct', 'enum', 'trait', 'impl', 'mod', 'use', 'pub', 'let'],
    qualifier: '::'
  },
  parse: { grammar: 'rust', queries: 'rust', grammarStatus: 'vetted', errorPolicy: 'report' },
  engines: {
    index: 'legacy-polyglot',
    outline: 'legacy-polyglot',
    symbol: 'legacy-polyglot',
    logic: 'text',
    audit: 'text',
    editGate: 'text'
  },
  stages: { source: 'on', index: 'text', outline: 'text', imports: 'text' },
  symbols: { exportRule: { kind: 'modifier', anyOf: ['pub'], default: false } },
  imports: { resolver: 'rust-crate', normalize: 'rust-use-tree' },
  layout: {},
  ecosystems: ['cargo'],
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
