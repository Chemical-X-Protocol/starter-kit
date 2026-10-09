import { test } from 'node:test';
import assert from 'node:assert';
import { createUiAuth, checkUiRequest, resolveUiUrlHost } from './ui-auth.js';

const request = (auth, host) => checkUiRequest(
  { method: 'GET', headers: { host, 'x-chemx-token': auth.token } }, auth, new URL('http://x.invalid/api/status'));

const LAN = { bindHost: '0.0.0.0', interfaceAddresses: ['192.168.1.50', 'fe80::1'], hostName: 'MyBox' };

test('ui auth: a wildcard bind accepts the machine addresses and hostname as Host', () => {
  const auth = createUiAuth(LAN);
  for (const host of ['192.168.1.50:4173', 'mybox:4173', 'mybox.local:4173', '[fe80::1]:4173', '127.0.0.1:4173']) {
    assert.strictEqual(request(auth, host).allowed, true, host);
  }
  assert.strictEqual(request(auth, 'evil.example:4173').status, 403);
});

test('ui auth: --allow-host adds names; a loopback bind still refuses LAN Host values', () => {
  const lan = createUiAuth({ ...LAN, allowHosts: ['dev.example.test'] });
  assert.strictEqual(request(lan, 'dev.example.test:4173').allowed, true);
  const loopback = createUiAuth({ bindHost: '127.0.0.1', interfaceAddresses: ['192.168.1.50'], hostName: 'mybox' });
  assert.strictEqual(request(loopback, '192.168.1.50:4173').status, 403);
});

test('ui auth: the printed URL for a wildcard bind is a reachable LAN address, not 0.0.0.0', () => {
  assert.strictEqual(resolveUiUrlHost('0.0.0.0', ['192.168.1.50']), '192.168.1.50');
  assert.strictEqual(resolveUiUrlHost('::', []), '127.0.0.1');
  assert.strictEqual(resolveUiUrlHost('127.0.0.1', ['192.168.1.50']), '127.0.0.1');
  assert.strictEqual(resolveUiUrlHost('::1', []), '[::1]');
});
