import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { CATCH_FIXTURES } from '../fixtures/php/catch.fixtures.js';
import { catchPass } from './php-catch.js';

const run = (code) => {
  const ctx = buildPassContext(code);
  catchPass(ctx);
  return ctx.records;
};

const wrap = (catches) => `<?php
function demo() {
    try {
        work();
    }${catches}
}
`;

test('empty and comment-only catches report ERROR_SWALLOWED_EXCEPTION with span', () => {
  const [rec] = run(CATCH_FIXTURES.ERROR_SWALLOWED_EXCEPTION.bad);
  assert.equal(rec.rule, 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(rec.line, 6);
  assert.equal(rec.endLine, 8);
  assert.equal(run('<?php try { a(); } catch (Exception $e) {}').length, 1);
});

test('catch bodies that handle the error are silent', () => {
  assert.deepEqual(run(CATCH_FIXTURES.ERROR_SWALLOWED_EXCEPTION.good), []);
  const bodies = ['throw $e;', 'return $e->getMessage();', 'echo "x";', 'exit;', '$this->err = $e;', '$x = new Foo();', 'cleanup();'];
  for (const body of bodies) assert.deepEqual(run(wrap(`\n    catch (Exception $e) { ${body} }`)), [], body);
});

test('a catch that only reassigns its variable or returns nothing is swallowed', () => {
  assert.equal(run(wrap('\n    catch (Exception $e) { $e = null; }'))[0].rule, 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(run(wrap('\n    catch (Exception $e) { return; }'))[0].rule, 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(run(wrap('\n    catch (Exception $e) { $e = 1; function () { work(); }; }'))[0].rule, 'ERROR_SWALLOWED_EXCEPTION');
});

test('single shallow call reports AI_SLOP_SHALLOW_CATCH, not ERROR_SWALLOWED_EXCEPTION', () => {
  for (const call of ['error_log("x")', 'trigger_error("x")', 'var_dump($e)', 'print_r($e)', 'var_export($e)', 'dump($e)', 'dd($e)']) {
    const records = run(wrap(`\n    catch (Exception $e) { ${call}; }`));
    assert.deepEqual(records.map((r) => r.rule), ['AI_SLOP_SHALLOW_CATCH'], call);
  }
  assert.deepEqual(run(CATCH_FIXTURES.AI_SLOP_SHALLOW_CATCH.good), []);
  assert.deepEqual(run(wrap('\n    catch (Exception $e) { $this->log->error("x"); }')), []);
  assert.deepEqual(run(wrap('\n    catch (Exception $e) { error_log("x"); cleanup(); }')), []);
});

test('tryBraceLine is the try brace for the first catch and the previous catch brace after', () => {
  const code = `<?php
function demo() {
    try {
        work();
    }
    catch (A $e) {
        // first
    }
    catch (B $e) {
        // second
    }
}
`;
  const [first, second] = run(code);
  assert.equal(first.line, 6);
  assert.equal(first.endLine, 8);
  assert.equal(first.tryBraceLine, 5);
  assert.equal(second.line, 9);
  assert.equal(second.endLine, 11);
  assert.equal(second.tryBraceLine, 8);
});

test('same-line brace style carries no tryBraceLine', () => {
  const [rec] = run('<?php\ntry {\n  a();\n} catch (Exception $e) {\n}\n');
  assert.equal(rec.tryBraceLine, undefined);
  assert.equal(rec.line, 4);
});

test('each fixture pair: bad fires its rule, good is clean under the catch pass', () => {
  const catchPairs = Object.entries(CATCH_FIXTURES).filter(([rule]) => rule !== 'UNGUARDED_LOGGING');
  for (const [rule, pair] of catchPairs) {
    assert.deepEqual(run(pair.bad).map((r) => r.rule), [rule], rule);
    assert.deepEqual(run(pair.good), [], rule);
  }
});

test('union-type catches and nested trys report once each', () => {
  assert.equal(run('<?php try { a(); } catch (A | B $e) { }').length, 1);
  const nested = run('<?php try { a(); } catch (A $e) { try { b(); } catch (C $f) { } }');
  assert.equal(nested.length, 1);
  assert.equal(nested[0].rule, 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(nested[0].column, 47);
});
