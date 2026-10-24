import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from '../php/php-parse.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from '../php/php-comments.js';
import { applyAuditPostFilters } from './suppressions.js';

const filter = (src, violations) => {
  const parsed = parsePhp(src);
  const lines = src.split('\n');
  return applyAuditPostFilters(violations, lines, {
    commentRegions: buildPhpCommentRegions(parsed.comments, lines),
    fileHeaderEndLine: phpHeaderEndLine(parsed.ast, parsed.comments, lines),
  });
};
const v = (line, rule = 'X_RULE') => ({ rule, line, severity: 'warning', message: 'm' });

test('PHP //, # and /* */ annotations suppress the next line', () => {
  for (const c of ['// chemx-allow: X_RULE a real reason', '# chemx-allow: X_RULE a real reason', '/* chemx-allow: X_RULE a real reason */']) {
    const out = filter('<?php\n' + c + '\n$a = 1;\n', [v(3)]);
    assert.equal(out.filter((x) => x.rule === 'X_RULE').length, 0, c);
  }
});

test('a ?>-terminated PHP comment annotation suppresses', () => {
  const out = filter('<?php\n// chemx-allow: X_RULE a real reason ?>\n$a = 1;\n', [v(3)]);
  assert.equal(out.filter((x) => x.rule === 'X_RULE').length, 0);
});

test('an annotation inside a multi-line PHP string is ignored', () => {
  const out = filter('<?php\n$s = "x\n// chemx-allow: X_RULE nope nope";\n$a = 1;\n', [v(4)]);
  assert.equal(out.filter((x) => x.rule === 'X_RULE').length, 1);
});

test('a header annotation suppresses a line-1 LINE_BUDGET_FILE', () => {
  const src = '<?php\n// chemx-allow: LINE_BUDGET_FILE generated file\nclass A {}\n';
  const out = filter(src, [v(1, 'LINE_BUDGET_FILE')]);
  assert.equal(out.filter((x) => x.rule === 'LINE_BUDGET_FILE').length, 0);
});
