import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const rulesAt = (violations, rule) => violations.filter((v) => v.rule === rule);
const audit = (code, rel = 'src/lib/sample.ts') => auditCode(code, rel, rel);

test('a leaky setInterval is flagged even when the function returns a value', () => {
  const code = 'export function leaky(tick) {\n  setInterval(tick, 1000);\n  return 42;\n}\n';
  const timers = rulesAt(audit(code), 'TIMER_DISCIPLINE');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].severity, 'CRITICAL');
});

test('an interval cleared in a sibling onBeforeUnmount closure is not flagged', () => {
  const code = [
    'import { onMounted, onBeforeUnmount } from "vue";',
    'let handle = null;',
    'onMounted(() => {',
    '  handle = setInterval(tick, 1000);',
    '});',
    'onBeforeUnmount(() => {',
    '  clearInterval(handle);',
    '});'
  ].join('\n');
  assert.equal(rulesAt(audit(code), 'TIMER_DISCIPLINE').length, 0);
});

test('a member-held timer cleared elsewhere in the module is not flagged', () => {
  const code = [
    'export const store = {',
    '  timer: null,',
    '  schedule() { this.timer = setTimeout(() => this.flush(), 200); },',
    '  cancel() { clearTimeout(this.timer); }',
    '};'
  ].join('\n');
  assert.equal(rulesAt(audit(code), 'TIMER_DISCIPLINE').length, 0);
});

test('a React effect that returns a cleanup is not flagged', () => {
  const code = 'export function useTick(tick) {\n  useEffect(() => {\n    const id = setInterval(tick, 1000);\n    return () => clearInterval(id);\n  }, []);\n}\n';
  assert.equal(rulesAt(audit(code), 'TIMER_DISCIPLINE').length, 0);
});

test('a one-shot setTimeout without a handle is LOW, not CRITICAL', () => {
  const code = 'export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n';
  const timers = rulesAt(audit(code), 'TIMER_DISCIPLINE');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].severity, 'LOW');
});

test('a listener removed in a sibling onUnmounted closure is not flagged', () => {
  const code = [
    'import { onMounted, onUnmounted } from "vue";',
    'const onResize = () => {};',
    'onMounted(() => {',
    '  window.addEventListener("resize", onResize);',
    '});',
    'onUnmounted(() => {',
    '  window.removeEventListener("resize", onResize);',
    '});'
  ].join('\n');
  assert.equal(rulesAt(audit(code), 'LIFECYCLE_ORPHANED_LISTENER').length, 0);
});

test('a listener bound to an AbortController signal is not flagged', () => {
  const code = 'export function watch(onResize, controller) {\n  window.addEventListener("resize", onResize, { signal: controller.signal });\n}\n';
  assert.equal(rulesAt(audit(code), 'LIFECYCLE_ORPHANED_LISTENER').length, 0);
});

test('a listener removed for a different event is still flagged', () => {
  const code = [
    'export function watch(onResize) {',
    '  window.addEventListener("resize", onResize);',
    '  return () => window.removeEventListener("scroll", onResize);',
    '}'
  ].join('\n');
  assert.equal(rulesAt(audit(code), 'LIFECYCLE_ORPHANED_LISTENER').length, 1);
});
