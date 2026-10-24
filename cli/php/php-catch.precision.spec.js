// Weighted precision cases for ERROR_SWALLOWED_EXCEPTION, AI_SLOP_SHALLOW_CATCH and UNGUARDED_LOGGING.
// Each case is a minimal snippet with generic names reduced from a labelled hit. origin: corpus (the 674-file
// tracked PHP set) or held-out (design spec 2.6: card vault HEAD 650b4aa exported read-only, plus the named
// git-ignored plugins). truth is the label (TP or FP); fires says what the engine does. weight is the case weight.
// File:line labels for the held-out hits are recorded in the task #6473 comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { catchPass, RULE_DEFAULTS as CATCH_DEFAULTS } from './php-catch.js';
import { loggingPass, RULE_DEFAULTS as LOGGING_DEFAULTS } from './php-logging.js';

const inFn = (body) => `<?php\nfunction demo( $items ) {\n    ${body}\n}\n`;
const tryCatch = (catchBody) => inFn(`try { demo_work(); } catch ( Exception $e ) {\n        ${catchBody}\n    }`);

const SWALLOW = 'ERROR_SWALLOWED_EXCEPTION';
const SHALLOW = 'AI_SLOP_SHALLOW_CATCH';
const LOGGING = 'UNGUARDED_LOGGING';

const CASES = [
  // corpus: the 2 real swallows and the commented best-effort fallbacks
  { id: 'empty catch around an init call', origin: 'corpus', rule: SWALLOW, code: tryCatch(''), fires: true, truth: 'TP', weight: 3 },
  { id: 'continue in a loop catch', origin: 'corpus', rule: SWALLOW, code: inFn('foreach ( $items as $i ) { try { demo_work( $i ); } catch ( Throwable $e ) { continue; } }'), fires: true, truth: 'TP', weight: 3 },
  { id: 'comment-only fallback', origin: 'corpus', rule: SWALLOW, code: tryCatch('// Fallback to built-in engine below'), fires: true, truth: 'TP', weight: 2 },
  { id: 'comment-only ignore', origin: 'corpus', rule: SWALLOW, code: tryCatch('// Ignore analyzer exceptions'), fires: true, truth: 'TP', weight: 2 },
  { id: 'comment-only continue-even-if', origin: 'corpus', rule: SWALLOW, code: tryCatch('// Continue even if vacuum fails'), fires: true, truth: 'TP', weight: 2 },
  { id: 'error_log alone in a catch', origin: 'corpus', rule: SHALLOW, code: tryCatch('error_log( "[Demo] step failed: " . $e->getMessage() );'), fires: true, truth: 'TP', weight: 2 },
  { id: 'catch that rethrows is silent', origin: 'corpus', rule: SWALLOW, code: tryCatch('throw new RuntimeException( "demo", 0, $e );'), fires: false, truth: 'TP', weight: 2 },
  { id: 'catch that returns a WP_Error is silent', origin: 'corpus', rule: SWALLOW, code: tryCatch('return new WP_Error( "demo", "failed" );'), fires: false, truth: 'TP', weight: 2 },
  { id: 'error_log with error wording is silent', origin: 'corpus', rule: LOGGING, code: inFn('error_log( "Demo import failed: " . $items );'), fires: false, truth: 'TP', weight: 2 },
  { id: 'error_log inside a catch is silent', origin: 'corpus', rule: LOGGING, code: tryCatch('error_log( "Demo step" ); demo_cleanup();'), fires: false, truth: 'TP', weight: 2 },
  { id: 'print_r with true is silent', origin: 'corpus', rule: LOGGING, code: inFn('$text = print_r( $items, true );'), fires: false, truth: 'TP', weight: 2 },
  { id: 'info error_log in plain code', origin: 'corpus', rule: LOGGING, code: inFn('error_log( "[Demo] Cleaned up " . count( $items ) . " stale files" );'), fires: true, truth: 'TP', weight: 2 },
  { id: 'error_log with log file destination', origin: 'corpus', rule: LOGGING, code: inFn('@error_log( $items . "\\n", 3, "/tmp/debug.log" );'), fires: true, truth: 'TP', weight: 1 },
  // held-out: swallowed
  // weight counts the labelled hits that share the snippet's shape
  { id: 'documented ignore comment (6 hits)', origin: 'held-out', rule: SWALLOW, code: tryCatch('// Ignore errors coming from the add-on for now.\n        // TODO: Display an appropriate error message.'), fires: true, truth: 'TP', weight: 6 },
  { id: 'continue skips an item (4 hits)', origin: 'held-out', rule: SWALLOW, code: inFn('foreach ( $items as $k ) { try { demo_work( $k ); } catch ( Exception $e ) { continue; } }'), fires: true, truth: 'TP', weight: 4 },
  { id: 'bare return hides a failure (2 hits)', origin: 'held-out', rule: SWALLOW, code: tryCatch('return;'), fires: true, truth: 'TP', weight: 2 },
  { id: 'cleanup of a secret in the catch', origin: 'held-out', rule: SWALLOW, code: tryCatch('unset( $result );'), fires: true, truth: 'FP', weight: 1 },
  { id: 'error_log only, message names the wrong operation (2 hits)', origin: 'held-out', rule: SHALLOW, code: tryCatch('error_log( "Error purging varnish cache: " . $e->getMessage() );'), fires: true, truth: 'TP', weight: 2 },
  { id: 'error_log only, plain message (3 hits)', origin: 'held-out', rule: SHALLOW, code: tryCatch('error_log( "Error in local_to_utc(). Error: " . $e->getMessage() );'), fires: true, truth: 'TP', weight: 3 },
  { id: 'error_log only, explained concurrency reason', origin: 'held-out', rule: SHALLOW, code: tryCatch('// Another request may have deleted the action.\n        error_log( "Demo delete failed: " . $e->getMessage() );'), fires: true, truth: 'FP', weight: 1 },
  { id: 'debug dump of history', origin: 'held-out', rule: LOGGING, code: inFn('error_log( "Comment history: " . print_r( $items, true ) );'), fires: true, truth: 'TP', weight: 1 },
  { id: 'logger helper behind a local enabled flag (2 hits)', origin: 'held-out', rule: LOGGING, code: inFn('if ( $enabled ) { error_log( "[Demo] " . wp_json_encode( $items ) ); }'), fires: true, truth: 'FP', weight: 2 },
  { id: 'warning in an unspecified-field branch', origin: 'held-out', rule: LOGGING, code: inFn('if ( $items ) { error_log( "[Demo] Unspecified fields " . wp_json_encode( $items ) ); }'), fires: true, truth: 'FP', weight: 1 },
  { id: 'shim logging behind a custom switch (4 hits)', origin: 'held-out', rule: LOGGING, code: inFn('if ( self::log_all() ) { error_log( "Demo Shim: Missing method called" ); }'), fires: true, truth: 'FP', weight: 4 },
  { id: 'unknown type in a default branch', origin: 'held-out', rule: LOGGING, code: inFn('switch ( $items ) { default: error_log( "Unknown demo type" ); }'), fires: true, truth: 'FP', weight: 1 },
  { id: 'handle_error helper logging a code and data', origin: 'held-out', rule: LOGGING, code: inFn('error_log( "$items: $code: $data" );'), fires: true, truth: 'FP', weight: 1 },
  { id: 'WP_DEBUG guarded is silent', origin: 'held-out', rule: LOGGING, code: inFn('if ( defined( "WP_DEBUG" ) && WP_DEBUG ) { error_log( "Demo step" ); }'), fires: false, truth: 'TP', weight: 1 },
];

function firedRules(code) {
  const ctx = buildPassContext(code);
  catchPass(ctx);
  loggingPass(ctx);
  return ctx.records.map((record) => record.rule);
}

test('every case behaves as recorded', () => {
  for (const c of CASES) {
    const fired = firedRules(c.code).includes(c.rule);
    assert.equal(fired, c.fires, `${c.rule}: ${c.id}`);
  }
});

function weightedPrecision(rule, origin) {
  const fired = CASES.filter((c) => c.rule === rule && c.origin === origin && c.fires);
  const total = fired.reduce((sum, c) => sum + c.weight, 0);
  const correct = fired.filter((c) => c.truth === 'TP').reduce((sum, c) => sum + c.weight, 0);
  return total === 0 ? null : correct / total;
}

const DEFAULTS = { ...CATCH_DEFAULTS, ...LOGGING_DEFAULTS };

test('the real swallows and the commented fallbacks fire on the corpus', () => {
  for (const id of ['empty catch around an init call', 'continue in a loop catch', 'comment-only fallback']) {
    assert.ok(CASES.find((c) => c.id === id && c.fires), id);
  }
});

test('RULE_DEFAULTS.defaultOn matches the 80% bar on corpus and held-out labels (spec 2.6)', () => {
  for (const rule of [SWALLOW, SHALLOW, LOGGING]) {
    const corpus = weightedPrecision(rule, 'corpus');
    const heldOut = weightedPrecision(rule, 'held-out');
    const passes = corpus !== null && heldOut !== null && corpus >= 0.8 && heldOut >= 0.8;
    assert.equal(DEFAULTS[rule].defaultOn, passes, `${rule} corpus ${corpus} held-out ${heldOut}`);
  }
});
