import test from 'node:test';
import assert from 'node:assert';
import {
  isOfflineMode,
  resolveOfflineReason,
  describeOffline,
  resolveEndpoint,
  isAllowedOverrideUrl,
  announceOverride
} from './network-policy.js';

test('offline: CHEMX_OFFLINE=1 and DO_NOT_TRACK=1 both switch the network off', () => {
  assert.strictEqual(isOfflineMode({ CHEMX_OFFLINE: '1' }), true);
  assert.strictEqual(isOfflineMode({ DO_NOT_TRACK: '1' }), true);
  assert.strictEqual(resolveOfflineReason({ DO_NOT_TRACK: '1' }), 'DO_NOT_TRACK');
});

test('offline: unset, empty, 0 and false leave the network on', () => {
  for (const value of [undefined, '', '0', 'false', 'no', 'off']) {
    assert.strictEqual(isOfflineMode({ CHEMX_OFFLINE: value, DO_NOT_TRACK: value }), false, `value ${value}`);
  }
});

test('offline: the message names the switch and says no request was made', () => {
  const message = describeOffline('License check', { CHEMX_OFFLINE: '1' });
  assert.match(message, /CHEMX_OFFLINE=1/);
  assert.match(message, /No network request was made/);
});

test('override: https and loopback http are accepted', () => {
  assert.strictEqual(isAllowedOverrideUrl('https://example.com/api'), true);
  assert.strictEqual(isAllowedOverrideUrl('http://localhost:8787'), true);
  assert.strictEqual(isAllowedOverrideUrl('http://127.0.0.1:3000/x'), true);
});

test('override: plain http to a remote host, other schemes and junk are refused', () => {
  for (const raw of ['http://example.com', 'http://localhost.evil.com', 'ftp://example.com', 'file:///etc/passwd', 'not a url']) {
    assert.strictEqual(isAllowedOverrideUrl(raw), false, raw);
  }
});

test('resolveEndpoint: no override returns the default untouched', () => {
  const endpoint = resolveEndpoint('CHEMICAL_X_API_URL', 'https://default.example', {});
  assert.deepStrictEqual(endpoint, { url: 'https://default.example', isOverride: false, envName: 'CHEMICAL_X_API_URL', error: null });
});

test('resolveEndpoint: a refused override fails closed instead of falling back', () => {
  const endpoint = resolveEndpoint('COMPASS_GATEKEEPER_URL', 'https://default.example', { COMPASS_GATEKEEPER_URL: 'http://attacker.example' });
  assert.strictEqual(endpoint.url, null);
  assert.match(endpoint.error, /COMPASS_GATEKEEPER_URL=http:\/\/attacker\.example refused/);
});

test('announceOverride: prints the overriding host only for overrides', () => {
  const lines = [];
  const stream = { write: (chunk) => lines.push(chunk) };
  announceOverride(resolveEndpoint('CHEMICAL_X_API_URL', 'https://d.example', {}), stream);
  announceOverride(resolveEndpoint('CHEMICAL_X_API_URL', 'https://d.example', { CHEMICAL_X_API_URL: 'https://staging.example:8443/' }), stream);
  assert.deepStrictEqual(lines, ['Using CHEMICAL_X_API_URL override: staging.example:8443\n']);
});
