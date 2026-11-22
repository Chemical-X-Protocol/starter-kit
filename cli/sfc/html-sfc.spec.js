/**
 * Standalone HTML documents go through the shared SFC layer: inline JS <script> blocks
 * are extracted and parsed at their file line numbers while non-JS data blocks are skipped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode, auditCodeDetailed } from '../audit/rules.js';
import { parseSfc } from './sfc-parse.js';

const HTML_DOC = `<!doctype html>
<html>
<head>
  <style>body { color: #fff; }</style>
  <script type="application/json">{"level": 1}</script>
  <script type="importmap">{"imports": {"three": "/three.js"}}</script>
</head>
<body>
  <script>
    const pick = (a, b) => (a ? 1 : b ? 2 : 3);
  </script>
</body>
</html>
`;

test('an HTML inline script is audited with file line numbers while JSON/importmap scripts are skipped', () => {
  const { violations, coverage } = auditCodeDetailed(HTML_DOC, '/p/index.html', 'index.html');
  const rules = violations.map((v) => `${v.rule}:${v.line}`);
  assert.ok(!rules.some((r) => r.startsWith('SYNTAX_PARSE_ERROR')), rules.join(', '));
  assert.ok(rules.includes('CONTROL_FLOW_NESTED_TERNARY:10'), rules.join(', '));
  assert.equal(coverage.kind, 'ast');
  assert.equal(coverage.language, 'html');
});

test('the HTML parse exposes styles, script blocks, and a geometry-preserving overlay', () => {
  const sfc = parseSfc(HTML_DOC, '/p/index.html');
  assert.equal(sfc.errors.length, 0);
  assert.equal(sfc.styles.length, 1);
  assert.equal(sfc.styles[0].startLine, 4);
  assert.equal(sfc.scripts.length, 3);
  assert.equal(sfc.scriptOverlay.split('\n').length, HTML_DOC.split('\n').length);
  assert.ok(!sfc.scriptOverlay.includes('{"level": 1}'));
  assert.ok(sfc.scriptOverlay.includes('const pick'));
});

test('a real syntax error in an HTML inline script is reported at its file line', () => {
  const broken = '<html>\n<body>\n<script>\n  const a = ;\n</script>\n</body>\n</html>\n';
  const rules = auditCode(broken, '/p/bad.html', 'bad.html').map((v) => `${v.rule}:${v.line}`);
  assert.ok(rules.includes('SYNTAX_PARSE_ERROR:4'), rules.join(', '));
});

test('an HTML file with only an external module script produces empty coverage and 0 parse errors', () => {
  const external = '<!doctype html>\n<html><body><script type="module" src="/src/main.ts"></script></body></html>\n';
  const { violations, coverage } = auditCodeDetailed(external, '/p/app.html', 'app.html');
  assert.deepEqual(violations, []);
  assert.equal(coverage.kind, 'empty');
  assert.equal(coverage.language, 'html');
});
