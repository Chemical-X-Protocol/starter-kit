import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from '../php/php-parse.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from '../php/php-comments.js';
import { auditCode } from './rules.js';
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

// What the post-filters make of a finding of rule on line (no columns, line scanner): dropped by
// an annotation with a reason, kept with the "reason is mandatory" note, or kept as it was.
const verdict = (src, line = 1, rule = 'ERROR_SWALLOWED_EXCEPTION') => {
  const [finding] = applyAuditPostFilters([v(line, rule)], src.split('\n'));
  if (!finding) return 'suppressed';
  return /reason is mandatory/.test(finding.hazard) ? 'noted' : 'flagged';
};
const catchColumns = (code) => auditCode(code, 'src/x.ts', 'src/x.ts', { config: {} })
  .filter((x) => x.rule === 'ERROR_SWALLOWED_EXCEPTION')
  .map((x) => [x.line, x.column]);

test('an annotation token may be followed by a colon before its reason', () => {
  assert.equal(verdict('} // chemx-allow: best-effort optional telemetry'), 'suppressed');
  assert.equal(verdict('} // chemx-allow: best-effort: optional telemetry'), 'suppressed');
});

test('a colon with no letter or digit after it is not a reason, and a token that runs into a word is not the token', () => {
  assert.equal(verdict('// chemx-allow: best-effort: -'), 'noted');
  assert.equal(verdict('// chemx-allow: best-effort:'), 'noted');
  assert.equal(verdict('// chemx-allow: best-effort-ish: because'), 'flagged');
});

test('any non-word separator ends the token and leading separators leave the reason (C1)', () => {
  for (const separator of [', ', '. ', '(', '/', ': ', '-- ', ' - ', ';']) {
    assert.equal(verdict(`// chemx-allow: best-effort${separator}warm cache`), 'suppressed', separator);
    assert.equal(verdict(`// chemx-allow: best-effort${separator}`), 'noted', separator);
  }
  for (const token of ['best-effort-ish', 'best-effort_x', 'best-effort2']) {
    assert.equal(verdict(`// chemx-allow: ${token} reason`), 'flagged', token);
  }
  assert.equal(verdict('// chemx-allow: A11Y_CLICKABLE_NON_SEMANTIC legacy markup', 1, 'A11Y_CLICKABLE_NON_SEMANTIC'), 'suppressed');
  assert.equal(verdict('/* chemx-allow: X_RULE: */ x(); /* still\n open reason */\ncode();\n', 3, 'X_RULE'), 'suppressed');
});

test('every marker on a line is its own annotation, with the reason ending at the next marker (C4)', () => {
  const line = 'f(); /* chemx-allow: best-effort one */ g(); /* chemx-allow: X_RULE two */';
  assert.deepEqual([verdict(line), verdict(line, 1, 'X_RULE')], ['suppressed', 'suppressed']);
  const shared = '// chemx-allow: best-effort first chemx-allow: X_RULE second';
  assert.deepEqual([verdict(shared), verdict(shared, 1, 'X_RULE')], ['suppressed', 'suppressed']);
  const twoTries = 'try { a(); } catch {} /* chemx-allow: best-effort one */ try { b(); } catch {}';
  assert.deepEqual(catchColumns(`${twoTries}\n`), [[1, 70]]);
  assert.deepEqual(catchColumns(`${twoTries} /* chemx-allow: best-effort two */\n`), []);
});

test('a block annotation open at the end of its marker line lasts to the closer, keeping its own reason (SC-4)', () => {
  const open = '/* chemx-allow: best-effort warm cache\n * still the same comment\n */\nx();\ny();';
  assert.deepEqual([verdict(open, 4), verdict(open, 5)], ['suppressed', 'flagged']);
  assert.deepEqual(catchColumns('f(); /*\n * chemx-allow: best-effort reason\n */\ntry { a(); } catch {}\n'), [[4, 13]]);
  assert.deepEqual(catchColumns('/**\n * chemx-allow: best-effort reason\n */\ntry { a(); } catch {}\n'), []);
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

// Block-comment shapes for a rule outside the catch family, one mark per line: S where a finding
// on that line is suppressed, . where it stays. `main` is what 4ea6eb2 gave; the window may widen
// it but never drop a line, whatever line opened the comment.
const BLOCK_SHAPES = [
  ['opened after code, marker on a continuation line, closer alone', 'f(); /* first\n * chemx-allow: X_RULE legacy api\n */\ncode();\nmore();', '.SS..', '.SSS.'],
  ['opened after code, marker on a continuation line that closes it', 'f(); /* first\n * chemx-allow: X_RULE legacy api */\ncode();\nmore();', '.SS.', '.SS.'],
  ['opened after code, marker on a continuation line, closer with code after', 'f(); /* first\n * chemx-allow: X_RULE legacy api\n */ code();\nmore();', '.SS.', '.SSS'],
  ['opened after code, reasonless marker on a continuation line', 'f(); /* first\n * chemx-allow: X_RULE\n * legacy api\n */\ncode();\nmore();', '.S..S.', '.SSSS.'],
  ['opened after code, marker on the opener, closer alone', 'f(); /* chemx-allow: X_RULE legacy api\n */\ncode();', 'S..', 'S..'],
  ['opened after code, marker on the opener, closer with code after', 'f(); /* chemx-allow: X_RULE legacy api\n */ code();\nmore();', 'S..', 'S..'],
  ['opened alone, marker on a continuation line, closer with code after', '/* first\n * chemx-allow: X_RULE legacy api\n */ code();\nmore();', '.SS.', '.SSS'],
  ['opened alone, marker on the opener, closer alone', '/* chemx-allow: X_RULE legacy api\n */\ncode();\nmore();', 'SS..', 'SSS.']
];

test('a block annotation covers at least the lines 4ea6eb2 covered, whatever line opened its comment (SC-4)', () => {
  for (const [shape, src, main, expected] of BLOCK_SHAPES) {
    const marks = src.split('\n').map((_, idx) => (scanned(src, idx + 1) === 0 ? 'S' : '.')).join('');
    assert.equal(marks, expected, shape);
    const keepsMain = [...main].every((mark, idx) => mark === '.' || expected[idx] === 'S');
    assert.ok(keepsMain, `${shape}: ${expected} drops a line of main's ${main}`);
  }
});

test('a finding outside the catch family keeps main\'s reading of the first marker on a line (C4, SC-4)', () => {
  assert.equal(scanned('code(); // chemx-allow: X_RULE chemx-allow: Y_RULE quoting\n', 1), 0);
  assert.equal(scanned('/* chemx-allow: X_RULE */ x(); /* still\n open reason */\ncode();\n', 3), 0);
  assert.equal(scanned('code(); /* chemx-allow: X_RULE */ /* tail\n reason here */\n', 1), 0);
  assert.equal(scanned('/* chemx-allow: X_RULE */ x(); /* still\n open reason */\ncode();\nmore();\n', 4), 1);
  const catchFamily = (src, line) => applyAuditPostFilters([v(line, 'ERROR_SWALLOWED_EXCEPTION')], src.split('\n')).length;
  assert.equal(catchFamily('code(); // chemx-allow: best-effort chemx-allow: Y_RULE quoting\n', 1), 1);
  assert.equal(catchFamily('/* chemx-allow: best-effort */ x(); /* still\n open reason */\ncode();\n', 3), 1);
  assert.equal(verdict('code(); // chemx-allow: X_RULE chemx-allow: Y_RULE quoting', 1, 'Y_RULE'), 'suppressed');
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
