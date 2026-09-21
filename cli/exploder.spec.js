import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseCompactFile, explodeCapsule } from './exploder.js';

const SAMPLE_COMPACT_CODE = `import type { ReactNode } from 'react';
import { useState } from 'react';

export interface CounterProps {
  readonly className?: string;
  readonly children?: ReactNode;
  readonly initialCount?: number;
}

export interface CounterState {
  readonly count: number;
}

export const useCounterController = (options: { initialCount?: number } = {}) => {
  const [count, setCount] = useState<number>(options.initialCount || 0);
  const increment = () => setCount((c) => c + 1);
  return { count, increment };
};

export const Counter = ({ className = '', initialCount = 0 }: CounterProps) => {
  const { count, increment } = useCounterController({ initialCount });
  return (
    <div className={\`m-counter \${className}\`.trim()}>
      <button type="button" onClick={increment}>Count: {count}</button>
    </div>
  );
};

export default Counter;
`;

test('exploder: parseCompactFile extracts types, controller, and component sections', () => {
  const parsed = parseCompactFile(SAMPLE_COMPACT_CODE, 'tsx');
  assert.ok(parsed.typesProps.includes('CounterProps'), 'Must extract CounterProps');
  assert.ok(parsed.typesState.includes('CounterState'), 'Must extract CounterState');
  assert.ok(parsed.controllerHookCode.includes('useCounterController'), 'Must extract controller hook');
  assert.ok(parsed.componentCode.includes('export const Counter'), 'Must extract component body');
});

test('exploder: explodeCapsule unpacks single file into multi-file capsule and removes .temp.bak', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-explode');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const compactFile = path.join(tmpDir, 'm-counter.tsx');
  fs.writeFileSync(compactFile, SAMPLE_COMPACT_CODE, 'utf-8');

  const result = explodeCapsule(compactFile, { cwd: tmpDir });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.capsuleName, 'm-counter');

  // Verify single file is gone and bak is cleaned up
  assert.strictEqual(fs.existsSync(compactFile), false, 'Original file should be replaced');
  assert.strictEqual(fs.existsSync(`${compactFile}.temp.bak`), false, 'Temp bak must be removed on success');

  // Verify unpacked capsule structure
  const capsuleDir = path.join(tmpDir, 'm-counter');
  assert.ok(fs.existsSync(capsuleDir), 'Directory capsule must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-counter.tsx')), 'Component must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-counter.controller.ts')), 'Controller must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-counter.spec.ts')), 'Spec must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'index.ts')), 'Index barrel must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/props.d.ts')), 'Props type must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/state.d.ts')), 'State type must exist');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types.d.ts')), 'Types barrel must exist');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('exploder: rolls back and restores from .temp.bak on failure', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-explode-fail');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // Invalid syntax that fails verification
  const invalidCode = 'export const Bad = () => { return <div missing closing tag>; };';
  const targetFile = path.join(tmpDir, 'm-bad.tsx');
  fs.writeFileSync(targetFile, invalidCode, 'utf-8');

  assert.throws(() => {
    explodeCapsule(targetFile, { cwd: tmpDir });
  }, /Explode transaction aborted/);

  // Original file must be restored
  assert.ok(fs.existsSync(targetFile), 'Original file must be restored on failure');
  assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), invalidCode);
  // Backup must be cleaned up
  assert.strictEqual(fs.existsSync(`${targetFile}.temp.bak`), false, 'Temp bak must be cleaned up');
  // Capsule dir must not exist
  assert.strictEqual(fs.existsSync(path.join(tmpDir, 'm-bad')), false, 'Failed capsule dir must be removed');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
