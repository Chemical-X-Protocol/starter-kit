import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCalleesFromCode,
  calculateCallTrace,
  calculateBacktrace
} from './search-queries-graph.js';
import {
  handleCallTraceCommand,
  handleBacktraceCommand
} from './search-commands-graph.js';
import { openIndexDb, upsertFileIndex } from './search-db.js';

describe('Call Trace & Backtrace Engine', () => {
  it('extracts call expressions from code snippet', () => {
    const code = `
      const handleAction = async () => {
        if (!canProceed.value) return;
        state.value = { status: 'loading' };
        await api.postOrder(items.value);
        emit('success');
      };
    `;
    const callees = extractCalleesFromCode(code);
    assert.ok(callees.includes('api.postOrder'), 'Should extract api.postOrder');
    assert.ok(callees.includes('emit'), 'Should extract emit');
  });

  it('calculates forward call trace gracefully on unknown or empty target', () => {
    const db = openIndexDb();
    const trace = calculateCallTrace(db, 'nonExistentSymbol', { maxDepth: 2 });
    assert.equal(trace.target, 'nonExistentSymbol');
    assert.equal(trace.totalCallees, 0);
    assert.deepEqual(trace.callees, []);
  });

  it('calculates reverse backtrace using recursive imports CTE', () => {
    const db = openIndexDb();

    upsertFileIndex(db, {
      path: 'src/controllers/trace-cart.ts',
      mtime: Date.now(),
      size: 400,
      tier: 'hook',
      lines: 40,
      chars: 400,
      symbols: [{ name: 'useTraceCartController', kind: 'const', isExport: true, startLine: 1, endLine: 40 }],
      imports: []
    });

    upsertFileIndex(db, {
      path: 'src/organisms/trace-cart.vue',
      mtime: Date.now(),
      size: 800,
      tier: 'organism',
      lines: 80,
      chars: 800,
      symbols: [{ name: 'TraceCartOrganism', kind: 'const', isExport: true, startLine: 1, endLine: 80 }],
      imports: [
        { importedSymbol: 'useTraceCartController', sourceModule: '@/controllers/trace-cart.ts', resolvedPath: 'src/controllers/trace-cart.ts', line: 3 }
      ]
    });

    upsertFileIndex(db, {
      path: 'src/views/trace-checkout.vue',
      mtime: Date.now(),
      size: 500,
      tier: 'view',
      lines: 50,
      chars: 500,
      symbols: [{ name: 'TraceCheckoutView', kind: 'const', isExport: true, startLine: 1, endLine: 50 }],
      imports: [
        { importedSymbol: 'TraceCartOrganism', sourceModule: '@/organisms/trace-cart.vue', resolvedPath: 'src/organisms/trace-cart.vue', line: 5 }
      ]
    });

    const backtrace = calculateBacktrace(db, 'useTraceCartController', { maxDepth: 5 });
    assert.equal(backtrace.target, 'useTraceCartController');
    assert.ok(backtrace.totalCallers >= 2, `Expected at least 2 callers, got ${backtrace.totalCallers}`);
    assert.ok(backtrace.chains.some((c) => c.includes('trace-checkout.vue')), 'Causal chain should reach root view');
    assert.ok(backtrace.rootCallers.some((r) => r.tier === 'view'), 'Root callers should include view tier');
  });

  it('formats call trace and backtrace as JSON payloads', () => {
    const db = openIndexDb();
    const traceRes = handleCallTraceCommand(db, 'foo', { isJson: true, isCli: false });
    assert.equal(traceRes.target, 'foo');

    const backtraceRes = handleBacktraceCommand(db, 'foo', { isJson: true, isCli: false });
    assert.equal(backtraceRes.target, 'foo');
  });
});
