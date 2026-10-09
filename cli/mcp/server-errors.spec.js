import test from 'node:test';
import assert from 'node:assert';
import { startPipeServer, byId, KIT_ROOT } from './spec-harness.js';

test('stdio: malformed JSON gets -32700 with id null', async () => {
  const pipe = startPipeServer({ bootDir: KIT_ROOT });
  pipe.send('{not json');
  const frame = await pipe.next((f) => f.error?.code === -32700);
  assert.strictEqual(frame.id, null);
  pipe.close();
});

test('stdio: tools/call without a tool name answers the request id with -32602', async () => {
  const pipe = startPipeServer({ bootDir: KIT_ROOT });
  pipe.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { arguments: {} } });
  pipe.send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: null });
  const missingName = await pipe.next(byId(7));
  const nullParams = await pipe.next(byId(8));
  assert.strictEqual(missingName.error.code, -32602);
  assert.strictEqual(nullParams.error.code, -32602);
  pipe.close();
});

test('stdio: a handler exception answers the request id with -32603', async () => {
  const handler = { handleRequest: async () => { throw new Error('boom'); }, onResponse: () => false };
  const pipe = startPipeServer({ handler });
  pipe.send({ jsonrpc: '2.0', id: 'abc', method: 'ping' });
  const frame = await pipe.next(byId('abc'));
  assert.strictEqual(frame.error.code, -32603);
  assert.match(frame.error.message, /boom/);
  pipe.close();
});

test('stdio: a JSON-RPC batch array is rejected with -32600 instead of silence', async () => {
  const pipe = startPipeServer({ bootDir: KIT_ROOT });
  pipe.send([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  const frame = await pipe.next((f) => f.error?.code === -32600);
  assert.strictEqual(frame.id, null);
  pipe.close();
});
