import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startUiServer } from './ui-server.js';

const makeProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ui-sec-'));

const rawRequest = (port, { method = 'GET', pathname = '/api/status', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    const hasBody = body !== undefined;
    if (hasBody) req.write(body);
    req.end();
  });

const withServer = async (fn) => {
  const cwd = makeProject();
  const running = await startUiServer({ port: 0, cwd });
  try { await fn(running, cwd); } finally {
    running.server.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

test('ui security: binds 127.0.0.1 by default, not 0.0.0.0', async () => {
  await withServer(async (running) => {
    assert.strictEqual(running.server.address().address, '127.0.0.1');
    assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]{20,}$/);
  });
});

test('ui security: API and HTML require the per-launch token', async () => {
  await withServer(async (running) => {
    const host = `127.0.0.1:${running.port}`;
    const noToken = await rawRequest(running.port, { headers: { host } });
    assert.strictEqual(noToken.status, 401);
    const html = await rawRequest(running.port, { pathname: '/', headers: { host } });
    assert.strictEqual(html.status, 401);
    const wrong = await rawRequest(running.port, { headers: { host, 'x-chemx-token': 'nope' } });
    assert.strictEqual(wrong.status, 401);
    const ok = await rawRequest(running.port, { headers: { host, 'x-chemx-token': running.token } });
    assert.strictEqual(ok.status, 200);
  });
});

test('ui security: ?token= on the page sets a strict HttpOnly cookie that authorizes the API', async () => {
  await withServer(async (running) => {
    const host = `127.0.0.1:${running.port}`;
    const page = await rawRequest(running.port, { pathname: `/?token=${running.token}`, headers: { host } });
    assert.strictEqual(page.status, 200);
    const cookie = String(page.headers['set-cookie'] || '');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const api = await rawRequest(running.port, { headers: { host, cookie: cookie.split(';')[0] } });
    assert.strictEqual(api.status, 200);
  });
});

test('ui security: cross-site text/plain POST (CORS simple request) is refused', async () => {
  await withServer(async (running, cwd) => {
    const host = `127.0.0.1:${running.port}`;
    const sql = `ATTACH DATABASE '${path.join(cwd, 'pwned.txt')}' AS p`;
    const plain = await rawRequest(running.port, {
      method: 'POST', pathname: '/api/database/query', body: JSON.stringify({ query: sql }),
      headers: { host, 'content-type': 'text/plain', 'x-chemx-token': running.token }
    });
    assert.strictEqual(plain.status, 415);
    const crossOrigin = await rawRequest(running.port, {
      method: 'POST', pathname: '/api/tasks', body: '{}',
      headers: { host, origin: 'https://evil.example', 'content-type': 'application/json', 'x-chemx-token': running.token }
    });
    assert.strictEqual(crossOrigin.status, 403);
    assert.strictEqual(fs.existsSync(path.join(cwd, 'pwned.txt')), false);
  });
});

test('ui security: DNS-rebinding Host header is refused', async () => {
  await withServer(async (running) => {
    const res = await rawRequest(running.port, { headers: { host: `evil.example:${running.port}`, 'x-chemx-token': running.token } });
    assert.strictEqual(res.status, 403);
  });
});

test('ui security: SQL console refuses ATTACH, DDL, DML and PRAGMA writes over HTTP', async () => {
  await withServer(async (running, cwd) => {
    const base = `http://127.0.0.1:${running.port}`;
    const post = async (route, query) => {
      const res = await running.fetch(`${base}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
      });
      return res.json();
    };
    const target = path.join(cwd, 'pwned.db');
    for (const route of ['/api/database/query', '/api/db/query']) {
      for (const sql of [`ATTACH DATABASE '${target}' AS p`, 'DROP TABLE agent_tasks', 'DELETE FROM agent_tasks',
        'PRAGMA journal_mode = DELETE', 'SELECT 1; DROP TABLE agent_tasks', 'WITH x AS (SELECT 1) DELETE FROM agent_tasks']) {
        const result = await post(route, sql);
        assert.strictEqual(result.success, false, `${route} must refuse: ${sql}`);
      }
      const ok = await post(route, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_tasks'");
      assert.strictEqual(ok.success, true);
      assert.strictEqual(ok.rows.length, 1, 'agent_tasks must survive');
    }
    assert.strictEqual(fs.existsSync(target), false);
  });
});

test('ui security: comment and quote smuggling cannot reach VACUUM INTO over HTTP', async () => {
  await withServer(async (running, cwd) => {
    const base = `http://127.0.0.1:${running.port}`;
    const copies = [];
    for (const route of ['/api/database/query', '/api/db/query']) {
      const copy = path.join(cwd, `vac-${copies.length}.db`);
      copies.push(copy);
      const res = await running.fetch(`${base}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `/* -- */ VACUUM INTO '${copy}';\n*/ SELECT 1` })
      });
      const result = await res.json();
      assert.strictEqual(result.success, false, `${route} must refuse the smuggled VACUUM`);
    }
    for (const copy of copies) assert.strictEqual(fs.existsSync(copy), false, `${copy} must not be created`);
  });
});

test('ui security: SSE feed does not send wildcard CORS', async () => {
  await withServer(async (running) => {
    const res = await running.fetch(`http://127.0.0.1:${running.port}/api/swarm/events`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    await res.body.cancel();
  });
});

test('ui security: malformed JSON bodies get 400 and metrics still count rows', async () => {
  await withServer(async (running) => {
    const base = `http://127.0.0.1:${running.port}`;
    const bad = await running.fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.strictEqual(bad.status, 400);
    const metrics = await (await running.fetch(`${base}/api/database/metrics`)).json();
    assert.strictEqual(metrics.success, true);
    assert.ok(metrics.tables.some((t) => t.name === 'agent_tasks' && t.rowCount === 0 && !t.error));
  });
});
