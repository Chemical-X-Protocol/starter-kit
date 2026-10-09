import test from 'node:test';
import assert from 'node:assert';
import { auditCode } from './rules.js';

test('Audit Rules: flags empty catch block as ERROR_SWALLOWED_EXCEPTION', () => {
  const code = `
export function parseConfig(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
  }
}
`;
  const violations = auditCode(code, 'src/config.js', 'src/config.js');
  const errorViolation = violations.find((v) => v.rule === 'ERROR_SWALLOWED_EXCEPTION');
  assert.ok(errorViolation, 'Expected ERROR_SWALLOWED_EXCEPTION for empty catch block');
  // Truth spec 4.2: MEDIUM unless the try assigns a binding that is read unset afterwards.
  assert.strictEqual(errorViolation.severity, 'MEDIUM');
});

test('Audit Rules: does NOT flag catch block that logs, rethrows, or returns ResultTuple', () => {
  const loggingCode = `
export function parseConfig(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.error('Failed to parse config:', err);
    return null;
  }
}
`;
  const logViolations = auditCode(loggingCode, 'src/config.js', 'src/config.js');
  assert.strictEqual(logViolations.find((v) => v.rule === 'ERROR_SWALLOWED_EXCEPTION'), undefined);

  const tupleCode = `
export function safeExecute(fn) {
  try {
    return [fn(), null];
  } catch (err) {
    return [null, err];
  }
}
`;
  const tupleViolations = auditCode(tupleCode, 'src/result.js', 'src/result.js');
  assert.strictEqual(tupleViolations.find((v) => v.rule === 'ERROR_SWALLOWED_EXCEPTION'), undefined);
});

test('Audit Rules: flags raw addEventListener lacking teardown as LIFECYCLE_ORPHANED_LISTENER', () => {
  const code = `
export function setupWindowWatcher(onResize) {
  window.addEventListener('resize', onResize);
}
`;
  const violations = auditCode(code, 'src/watcher.js', 'src/watcher.js');
  const listenerViolation = violations.find((v) => v.rule === 'LIFECYCLE_ORPHANED_LISTENER');
  assert.ok(listenerViolation, 'Expected LIFECYCLE_ORPHANED_LISTENER for raw addEventListener without teardown');
  assert.strictEqual(listenerViolation.severity, 'HIGH');
});

test('Audit Rules: does NOT flag addEventListener paired with removeEventListener or inside listen', () => {
  const pairedCode = `
export function setupWindowWatcher(onResize) {
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
  };
}
`;
  const pairedViolations = auditCode(pairedCode, 'src/watcher.js', 'src/watcher.js');
  assert.strictEqual(pairedViolations.find((v) => v.rule === 'LIFECYCLE_ORPHANED_LISTENER'), undefined);

  const listenCode = `
export function listen(target, event, handler) {
  target.addEventListener(event, handler);
  return () => target.removeEventListener(event, handler);
}
`;
  const listenViolations = auditCode(listenCode, 'src/listen.js', 'src/listen.js');
  assert.strictEqual(listenViolations.find((v) => v.rule === 'LIFECYCLE_ORPHANED_LISTENER'), undefined);
});

test('Audit Rules: flags 3+ chained optional operators as DATA_FLOW_OPTIONAL_CHAINING_CHURN', () => {
  const code = `
export function getTheme(user) {
  return user?.profile?.settings?.theme;
}
`;
  const violations = auditCode(code, 'src/theme.js', 'src/theme.js');
  const churnViolation = violations.find((v) => v.rule === 'DATA_FLOW_OPTIONAL_CHAINING_CHURN');
  assert.ok(churnViolation, 'Expected DATA_FLOW_OPTIONAL_CHAINING_CHURN for 3 chained optional operators');
  assert.strictEqual(churnViolation.severity, 'LOW');
});

test('Audit Rules: does NOT flag shallow optional chaining', () => {
  const code = `
export function getUserName(user) {
  return user?.name || user?.profile?.displayName;
}
`;
  const violations = auditCode(code, 'src/user.js', 'src/user.js');
  assert.strictEqual(violations.find((v) => v.rule === 'DATA_FLOW_OPTIONAL_CHAINING_CHURN'), undefined);
});

test('Audit Rules: flags raw boolean expression in combinator call as COMBINATOR_RAW_BOOLEAN', () => {
  const code = `
export function checkAccess(user) {
  return all(user.age >= 18, user.balance > 0);
}
`;
  const violations = auditCode(code, 'src/auth.js', 'src/auth.js');
  const combinatorViolation = violations.find((v) => v.rule === 'COMBINATOR_RAW_BOOLEAN');
  assert.ok(combinatorViolation, 'Expected COMBINATOR_RAW_BOOLEAN for raw expressions in all()');
  assert.strictEqual(combinatorViolation.severity, 'MEDIUM');
});

test('Audit Rules: does NOT flag named thunks or predicates passed to combinators', () => {
  const thunkCode = `
export function checkAccess(isAdult, hasBalance) {
  return all(isAdult, hasBalance);
}
`;
  const thunkViolations = auditCode(thunkCode, 'src/auth.js', 'src/auth.js');
  assert.strictEqual(thunkViolations.find((v) => v.rule === 'COMBINATOR_RAW_BOOLEAN'), undefined);

  const predicateCode = `
export const checkAccess = allPass(isAdult, hasBalance);
`;
  const predViolations = auditCode(predicateCode, 'src/auth.js', 'src/auth.js');
  assert.strictEqual(predViolations.find((v) => v.rule === 'COMBINATOR_RAW_BOOLEAN'), undefined);
});
