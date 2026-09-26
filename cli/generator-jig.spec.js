import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createJigFiles, normalizeJigKind, JIG_KINDS } from './generator-jig.js';
import { detectJigBaseDir, PRESET_DIRECTORY_MAPS } from './project-detector.js';

test('Jig: normalizeJigKind normalizes aliases and unknown kinds', () => {
  assert.strictEqual(normalizeJigKind('service'), 'service');
  assert.strictEqual(normalizeJigKind('endpoint'), 'route');
  assert.strictEqual(normalizeJigKind('route'), 'route');
  assert.strictEqual(normalizeJigKind('repository'), 'repo');
  assert.strictEqual(normalizeJigKind('repo'), 'repo');
  assert.strictEqual(normalizeJigKind('utility'), 'util');
  assert.strictEqual(normalizeJigKind('util'), 'util');
  assert.strictEqual(normalizeJigKind('spec'), 'spec');
  assert.strictEqual(normalizeJigKind('unknown-kind'), 'service');
});

test('Jig: createJigFiles dry run previews files without disk writes', () => {
  const tmpDir = path.join(os.tmpdir(), `chemx-jig-test-${Date.now()}`);
  const res = createJigFiles({
    kind: 'service',
    name: 'payment-gateway',
    dir: 'services',
    methods: ['charge(amount: number): Promise<ResultTuple<Receipt>>', 'refund(id: string)'],
    desc: 'Stripe payments handler',
    dryRun: true,
    cwd: tmpDir
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.jig, true);
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.kind, 'service');
  assert.strictEqual(res.filesCreated.length, 3);
  assert.ok(res.filesCreated.includes('service-payment-gateway.ts'));
  assert.ok(res.filesCreated.includes('service-payment-gateway.types.d.ts'));
  assert.ok(res.filesCreated.includes('service-payment-gateway.spec.ts'));
  assert.strictEqual(fs.existsSync(tmpDir), false);
});

test('Jig: createJigFiles generates service with Result tuples and tests on disk', () => {
  const tmpDir = path.join(os.tmpdir(), `chemx-jig-disk-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = createJigFiles({
    kind: 'service',
    name: 'billing-service',
    dir: 'src/services',
    methods: ['charge', 'refund'],
    desc: 'Billing domain service',
    dryRun: false,
    cwd: tmpDir
  });

  assert.strictEqual(res.success, true);
  const serviceFile = path.join(tmpDir, 'src/services/service-billing-service.ts');
  const typesFile = path.join(tmpDir, 'src/services/service-billing-service.types.d.ts');
  const specFile = path.join(tmpDir, 'src/services/service-billing-service.spec.ts');

  assert.ok(fs.existsSync(serviceFile));
  assert.ok(fs.existsSync(typesFile));
  assert.ok(fs.existsSync(specFile));

  const serviceContent = fs.readFileSync(serviceFile, 'utf-8');
  assert.ok(serviceContent.includes('export class BillingServiceService'));
  assert.ok(serviceContent.includes('ResultTuple'));
  assert.ok(serviceContent.includes('async charge'));
  assert.ok(serviceContent.includes('async refund'));
  assert.ok(serviceContent.split('\n').length < 100);

  const specContent = fs.readFileSync(specFile, 'utf-8');
  assert.ok(specContent.includes('BillingServiceService'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Jig: createJigFiles generates route with validation and status tests', () => {
  const tmpDir = path.join(os.tmpdir(), `chemx-jig-route-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = createJigFiles({
    kind: 'route',
    name: 'api-orders',
    routes: ['GET /orders', 'POST /orders'],
    dryRun: false,
    cwd: tmpDir
  });

  assert.strictEqual(res.success, true);
  const routeFile = path.join(res.targetDir, 'route-api-orders.ts');
  const specFile = path.join(res.targetDir, 'route-api-orders.spec.ts');

  assert.ok(fs.existsSync(routeFile));
  assert.ok(fs.existsSync(specFile));

  const content = fs.readFileSync(routeFile, 'utf-8');
  assert.ok(content.includes('handleGETApiOrders'));
  assert.ok(content.includes('handlePOSTApiOrders'));
  assert.ok(content.includes('status: 200'));
  assert.ok(content.includes('status: 400'));
  assert.ok(content.split('\n').length < 100);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Jig: createJigFiles generates store with discriminated union state', () => {
  const tmpDir = path.join(os.tmpdir(), `chemx-jig-store-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = createJigFiles({
    kind: 'store',
    name: 'auth-session',
    state: ['user: string', 'token: string'],
    dryRun: false,
    cwd: tmpDir
  });

  assert.strictEqual(res.success, true);
  const storeFile = path.join(res.targetDir, 'store-auth-session.ts');
  assert.ok(fs.existsSync(storeFile));

  const content = fs.readFileSync(storeFile, 'utf-8');
  assert.ok(content.includes("status: 'idle'"));
  assert.ok(content.includes("status: 'active'"));
  assert.ok(content.includes("status: 'fault'"));
  assert.ok(content.includes('transitionToActive'));
  assert.ok(content.split('\n').length < 100);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Jig: detectJigBaseDir resolves presets correctly', () => {
  const tmpDir = path.join(os.tmpdir(), `chemx-jig-preset-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  assert.strictEqual(detectJigBaseDir('service', { cwd: tmpDir, preset: 'src' }), 'src/services');
  assert.strictEqual(detectJigBaseDir('service', { cwd: tmpDir, preset: 'app' }), 'app/services');
  assert.strictEqual(detectJigBaseDir('service', { cwd: tmpDir, preset: 'root' }), 'services');
  assert.strictEqual(detectJigBaseDir('service', { cwd: tmpDir, preset: 'lib' }), 'src/lib/services');

  assert.strictEqual(detectJigBaseDir('route', { cwd: tmpDir, preset: 'app' }), 'server/api');
  assert.strictEqual(detectJigBaseDir('route', { cwd: tmpDir, preset: 'src' }), 'src/routes');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
