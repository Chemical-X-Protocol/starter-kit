import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const rulesAt = (violations, rule) => violations.filter((v) => v.rule === rule);
const auditVue = (code, rel = 'src/x/sample.vue') => auditCode(code, rel, rel);

const SETUP_WITH_TERNARY = [
  '<script setup lang="ts">',
  'const a = true',
  'const b = false',
  'const label = a ? 1 : b ? 2 : 3',
  '</script>'
].join('\n');

test('the setup block after a classic <script> block is audited', () => {
  const twoScripts = `<script lang="ts">\nexport default { name: 'Two' }\n</script>\n${SETUP_WITH_TERNARY}\n`;
  const hits = rulesAt(auditVue(twoScripts), 'CONTROL_FLOW_NESTED_TERNARY');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 7);
});

test('script blocks that redeclare a binding fall back to per-block parsing', () => {
  const code = `<script lang="ts">\nimport { ref } from 'vue'\nexport default { name: 'X' }\n</script>\n<script setup lang="ts">\nimport { ref } from 'vue'\nconst n = ref(0)\nconst s = n.value ? 1 : n.value > 2 ? 2 : 3\n</script>\n`;
  const violations = auditVue(code);
  assert.equal(rulesAt(violations, 'SYNTAX_PARSE_ERROR').length, 0);
  assert.equal(rulesAt(violations, 'CONTROL_FLOW_NESTED_TERNARY').length, 1);
});

test('nested ternaries in template interpolations and bindings are flagged at their line', () => {
  const code = [
    '<template>',
    '  <div :class="a ? \'x\' : b ? \'y\' : \'z\'">',
    '    <p>{{ a ? 1 : b ? 2 : 3 }}</p>',
    '  </div>',
    '</template>',
    '<script setup lang="ts">',
    'const a = true',
    'const b = false',
    '</script>'
  ].join('\n');
  const lines = rulesAt(auditVue(code), 'CONTROL_FLOW_NESTED_TERNARY').map((v) => v.line).sort();
  assert.deepEqual(lines, [2, 3]);
});

test('inline boolean soup in a template directive is flagged; a named computed is not', () => {
  const soup = '<template>\n  <p v-if="isA && isB || !isC && isD">x</p>\n</template>\n';
  assert.equal(rulesAt(auditVue(soup), 'CONTROL_FLOW_INLINE_BOOLEAN').length, 1);
  const named = '<template>\n  <p v-if="shouldShowPanel">x</p>\n</template>\n';
  assert.equal(rulesAt(auditVue(named), 'CONTROL_FLOW_INLINE_BOOLEAN').length, 0);
});

test('raw inline styles in templates are flagged; CSS custom properties are allowed', () => {
  const raw = '<template>\n  <p :style="{ color: \'#ff0000\' }">x</p>\n  <i style="color: red">y</i>\n</template>\n';
  assert.deepEqual(rulesAt(auditVue(raw), 'RAW_INLINE_STYLE').map((v) => v.line), [2, 3]);
  const vars = '<template>\n  <p :style="{ \'--win-x\': `${x}px` }">x</p>\n</template>\n';
  assert.equal(rulesAt(auditVue(vars), 'RAW_INLINE_STYLE').length, 0);
});

test('a template that does not parse is a SYNTAX_PARSE_ERROR, not a clean pass', () => {
  const broken = '<template>\n  <div>\n    <p>unclosed\n</template>\n';
  assert.ok(rulesAt(auditVue(broken), 'SYNTAX_PARSE_ERROR').length >= 1);
});
