import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from '../php/php-parse.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from '../php/php-comments.js';
import { auditCode } from './rules.js';
import { applyAuditPostFilters, parseAllowAnnotation, parseAllowAnnotations } from './suppressions.js';

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

test('an annotation token may be followed by a colon before its reason', () => {
  const plain = parseAllowAnnotation('} // chemx-allow: best-effort optional telemetry');
  const colon = parseAllowAnnotation('} // chemx-allow: best-effort: optional telemetry');
  assert.equal(colon.token, 'best-effort');
  assert.equal(colon.reason, plain.reason);
  assert.equal(colon.hasReason, true);
});

test('a colon with no letter or digit after it is not a reason, and a token that runs into a word is not the token', () => {
  assert.equal(parseAllowAnnotation('// chemx-allow: best-effort: -').hasReason, false);
  assert.equal(parseAllowAnnotation('// chemx-allow: best-effort:').hasReason, false);
  assert.equal(parseAllowAnnotation('// chemx-allow: best-effort-ish: because').token, 'best-effort-ish');
});

test('any non-word separator ends the token and leading separators leave the reason (C1)', () => {
  for (const separator of [', ', '. ', '(', '/', ': ', '-- ', ' - ', ';']) {
    const annotation = parseAllowAnnotation(`// chemx-allow: best-effort${separator}warm cache`);
    assert.equal(annotation.token, 'best-effort', separator);
    assert.equal(annotation.reason.startsWith('warm cache'), true, `${separator} gave ${annotation.reason}`);
  }
  for (const token of ['best-effort-ish', 'best-effort_x', 'best-effort2']) {
    assert.equal(parseAllowAnnotation(`// chemx-allow: ${token} reason`).token, token);
  }
  assert.equal(parseAllowAnnotation('// chemx-allow: A11Y_CLICKABLE_NON_SEMANTIC legacy markup').token, 'A11Y_CLICKABLE_NON_SEMANTIC');
});

test('every marker on a line is its own annotation, with the reason ending at the next marker (C4)', () => {
  const line = 'f(); /* chemx-allow: best-effort one */ g(); /* chemx-allow: X_RULE two */';
  const annotations = parseAllowAnnotations([line]);
  assert.deepEqual(annotations.map((a) => [a.line, a.token, a.reason, a.commentStart]), [
    [1, 'best-effort', 'one', line.indexOf('/*')],
    [1, 'X_RULE', 'two', line.lastIndexOf('/*')]
  ]);
  const shared = parseAllowAnnotations(['// chemx-allow: best-effort first chemx-allow: X_RULE second']);
  assert.deepEqual(shared.map((a) => [a.token, a.reason]), [['best-effort', 'first'], ['X_RULE', 'second']]);
});

test('a block annotation open at the end of its marker line lasts to the closer, keeping its own reason (SC-4)', () => {
  const [annotation] = parseAllowAnnotations(['/* chemx-allow: best-effort warm cache', ' * still the same comment', ' */', 'x();']);
  assert.deepEqual([annotation.reason, annotation.lastLine], ['warm cache', 3]);
  const [trailingCode] = parseAllowAnnotations(['f(); /*', ' * chemx-allow: best-effort reason', ' */']);
  assert.deepEqual([trailingCode.lastLine, trailingCode.isCommentOnly], [3, false]);
  const [jsdoc] = parseAllowAnnotations(['/**', ' * chemx-allow: best-effort reason', ' */']);
  assert.deepEqual([jsdoc.lastLine, jsdoc.isCommentOnly], [3, true]);
});

// The line scanner path (JS, TS, C#): a synthetic finding on one line, filtered with no PHP regions.
const scanned = (src, line) => applyAuditPostFilters([v(line)], src.split('\n')).filter((x) => x.rule === 'X_RULE').length;

test('a comment-only block annotation covers its own lines, a closer line shared with code and the line below (SC-4)', () => {
  const shared = '/* chemx-allow: X_RULE legacy api\n */ code();\nmore();\nlast();\n';
  assert.deepEqual([1, 2, 3, 4].map((line) => scanned(shared, line)), [0, 0, 0, 1]);
  const below = '/* chemx-allow: X_RULE legacy api\n * still the comment\n */\ncode();\nmore();\n';
  assert.deepEqual([2, 3, 4, 5].map((line) => scanned(below, line)), [0, 0, 0, 1]);
  assert.equal(scanned('f(); /* chemx-allow: X_RULE legacy api\n */ code();\n', 2), 1);
});

test('a PHP block annotation with its reason on the marker line lasts to its closer (SC-4)', () => {
  const shared = '<?php\n/* chemx-allow: X_RULE legacy api\n */ $a = 1;\n$b = 2;\n$c = 3;\n';
  assert.deepEqual([3, 4, 5].map((line) => filter(shared, [v(line)]).length), [0, 0, 1]);
  const below = '<?php\n/* chemx-allow: X_RULE legacy api\n * still the comment */\n$a = 1;\n';
  assert.equal(filter(below, [v(4)]).length, 0);
  const lineComment = '<?php\n// chemx-allow: X_RULE legacy api\n$a = 1;\n$b = 2;\n';
  assert.deepEqual([filter(lineComment, [v(3)]).length, filter(lineComment, [v(4)]).length], [0, 1]);
  const catchFamily = '<?php\nfunction g() {\n  /* chemx-allow: best-effort warm\n   * more */\n  try { a(); } catch (Exception $e) {}\n}\n';
  const hits = auditCode(catchFamily, 'src/x.php', 'src/x.php', { config: {} }).filter((x) => x.rule === 'ERROR_SWALLOWED_EXCEPTION');
  assert.deepEqual(hits, []);
  const unannotated = auditCode(catchFamily.replace('chemx-allow: ', ''), 'src/x.php', 'src/x.php', { config: {} });
  assert.equal(unannotated.filter((x) => x.rule === 'ERROR_SWALLOWED_EXCEPTION').length, 1);
});
