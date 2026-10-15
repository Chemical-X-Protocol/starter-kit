import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';
import { HOOK_ACTION_VERBS } from './hook-shape-validator.js';

const HOOK_SHAPE_RULES = new Set(['HOOK_SHAPE_CONTRACT']);
const hookShape = (violations) => violations.filter((v) => HOOK_SHAPE_RULES.has(v.rule));
const audit = (code, rel = 'src/composables/use-x.ts') => auditCode(code, rel, rel);

test('HOOK_ACTION_VERBS is exported, sorted, and has no duplicates', () => {
  assert(Array.isArray(HOOK_ACTION_VERBS), 'HOOK_ACTION_VERBS should be an array');
  assert(HOOK_ACTION_VERBS.length > 0, 'HOOK_ACTION_VERBS should not be empty');

  // Check for duplicates
  const uniqueSet = new Set(HOOK_ACTION_VERBS);
  assert.equal(uniqueSet.size, HOOK_ACTION_VERBS.length, 'HOOK_ACTION_VERBS should have no duplicates');

  // Check for alphabetical sorting
  const sorted = [...HOOK_ACTION_VERBS].sort();
  assert.deepEqual(HOOK_ACTION_VERBS, sorted, 'HOOK_ACTION_VERBS should be sorted alphabetically');
});

test('hook returning { templeName, rawhide, drafting } raises no intermediate value hazard', () => {
  const code = `
    export function useX() {
      const templeName = ref('');
      const rawhide = ref('');
      const drafting = ref('');
      return { templeName, rawhide, drafting };
    }
  `;
  const violations = hookShape(audit(code));
  const intermediateViolations = violations.filter((v) => v.hazard.includes('intermediate'));
  assert.equal(intermediateViolations.length, 0, 'should not flag templeName, rawhide, or drafting as intermediate');
});

test('hook returning { tempValue } raises intermediate value hazard', () => {
  const code = `
    export function useX() {
      const tempValue = ref('');
      return { tempValue };
    }
  `;
  const violations = hookShape(audit(code));
  const intermediateViolations = violations.filter((v) => v.hazard.includes('intermediate'));
  assert.equal(intermediateViolations.length, 1, 'should flag tempValue as intermediate');
  assert(intermediateViolations[0].hazard.includes('tempValue'), 'should mention tempValue in hazard');
});

test('hook returning { draft_item } raises intermediate value hazard', () => {
  const code = `
    export function useX() {
      const draft_item = ref('');
      return { draft_item };
    }
  `;
  const violations = hookShape(audit(code));
  const intermediateViolations = violations.filter((v) => v.hazard.includes('intermediate'));
  assert.equal(intermediateViolations.length, 1, 'should flag draft_item as intermediate');
  assert(intermediateViolations[0].hazard.includes('draft_item'), 'should mention draft_item in hazard');
});

test('hook returning { rawData } raises intermediate value hazard', () => {
  const code = `
    export function useX() {
      const rawData = ref('');
      return { rawData };
    }
  `;
  const violations = hookShape(audit(code));
  const intermediateViolations = violations.filter((v) => v.hazard.includes('intermediate'));
  assert.equal(intermediateViolations.length, 1, 'should flag rawData as intermediate');
  assert(intermediateViolations[0].hazard.includes('rawData'), 'should mention rawData in hazard');
});

test('function goHome raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const goHome = () => {};
      return { goHome };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag goHome as missing verb prefix');
});

test('function navigateTo raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const navigateTo = () => {};
      return { navigateTo };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag navigateTo as missing verb prefix');
});

test('function calculateTotal raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const calculateTotal = () => {};
      return { calculateTotal };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag calculateTotal as missing verb prefix');
});

test('function scrollToTop raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const scrollToTop = () => {};
      return { scrollToTop };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag scrollToTop as missing verb prefix');
});

test('function setupListeners raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const setupListeners = () => {};
      return { setupListeners };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag setupListeners as missing verb prefix');
});

test('function setValue raises no verb prefix hazard', () => {
  const code = `
    export function useX() {
      const setValue = () => {};
      return { setValue };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 0, 'should not flag setValue as missing verb prefix');
});

test('function thing raises verb prefix hazard', () => {
  const code = `
    export function useX() {
      const thing = () => {};
      return { thing };
    }
  `;
  const violations = hookShape(audit(code));
  const verbViolations = violations.filter((v) => v.hazard.includes('verb prefix'));
  assert.equal(verbViolations.length, 1, 'should flag thing as missing verb prefix');
  assert(verbViolations[0].hazard.includes('thing'), 'should mention thing in hazard');
});
