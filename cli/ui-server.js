import http from 'node:http';
import { openIndexDb } from './search-db.js';
import { handleSwarmStatus } from './ui-handlers.js';
import { generateSwarmHtml } from './ui-html.js';
import { routeGet, routePost, parseJsonBody } from './ui-server-routes.js';
import { handleSseConnection, broadcastSseUpdate, broadcastSseReload, closeSseHub } from './ui-sse.js';
import { createUiAuth, checkUiRequest, createUiFetch, isLoopbackHost, resolveUiUrlHost, DEFAULT_UI_HOST } from './ui-auth.js';
import { openConsoleDb } from './ui-sql-guard.js';

const sendJson = (res, status, payload, extraHeaders = {}, afterSend = null) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(payload));
  if (afterSend) afterSend();
  return res;
};

const runRoute = (handler) => {
  try { return [handler(), null]; } catch (err) { return [null, err]; }
};

export const createUiServer = (cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  const auth = options.auth || createUiAuth();
  const consoleDb = openConsoleDb(cwd);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://chemx-ui.invalid');
    const { pathname } = url;
    const isGet = req.method === 'GET', isPost = req.method === 'POST';
    const isApi = pathname.startsWith('/api/'), isFaviconRequest = isGet && pathname === '/favicon.ico';
    if (isFaviconRequest) return res.writeHead(204).end();

    const gate = checkUiRequest(req, auth, url);
    if (!gate.allowed) return sendJson(res, gate.status, { success: false, error: gate.error });
    const cookieHeaders = gate.setCookie ? { 'Set-Cookie': gate.setCookie } : {};

    const shouldServeHtml = isGet && !isApi;
    if (shouldServeHtml) {
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cookieHeaders }).end(generateSwarmHtml(handleSwarmStatus(db)));
    }

    if (isGet) {
      const isSse = pathname === '/api/swarm/events' || pathname === '/api/events';
      if (isSse) return handleSseConnection(req, res, db);
      const [result, getError] = runRoute(() => routeGet(req.url, db, cwd));
      if (getError) return sendJson(res, 500, { success: false, error: getError.message }, cookieHeaders);
      if (result) return sendJson(res, 200, result, cookieHeaders);
    }

    if (isPost) {
      const [body, parseError] = await parseJsonBody(req).then((value) => [value, null], (err) => [null, err]);
      if (parseError) return sendJson(res, 400, { error: 'Invalid JSON payload' });
      const [result, routeError] = runRoute(() => routePost(req.url, db, body, cwd, { consoleDb }));
      if (routeError) return sendJson(res, 500, { success: false, error: routeError.message });
      if (result) return sendJson(res, 200, result, {}, () => broadcastSseUpdate(db));
    }
    return sendJson(res, 404, { error: 'Not found' });
  });

  server.on('close', () => { closeSseHub(); consoleDb?.close(); });
  return { server, db, auth };
};

const warnPublicBind = (host) => process.stderr.write(
  `\x1b[33m⚠ chemx ui is bound to ${host}, reachable beyond this machine. Anyone with the token URL can drive the swarm.\x1b[0m\n`);

export const startUiServer = async (options = {}) => {
  const port = options.port !== undefined ? options.port : 4173;
  const host = options.host || DEFAULT_UI_HOST;
  const cwd = options.cwd || process.cwd();
  const auth = createUiAuth({ bindHost: host, token: options.token, allowHosts: options.allowHosts });
  const { server, db } = createUiServer(cwd, { auth });

  if (options.dev) {
    const { startUiDevWatcher } = await import('./ui-dev-watcher.js');
    const watcher = startUiDevWatcher(cwd, () => broadcastSseReload());
    server.on('close', () => watcher.close());
  }

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (options.isCli) process.stderr.write(`\x1b[31m✖ UI error: ${err.message}\x1b[0m\n`);
      reject(err);
    });

    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      auth.cookieName = `chemx_ui_${actualPort}`;
      const urlHost = resolveUiUrlHost(host);
      const url = `http://${urlHost}:${actualPort}/?token=${auth.token}`;
      if (options.isCli) {
        if (!isLoopbackHost(host)) warnPublicBind(host);
        process.stdout.write(`\x1b[32m✔ Chemical X Live Swarm Web UI listening on ${host}:${actualPort}:\x1b[0m \x1b[36m${url}\x1b[0m\n`);
        if (options.dev) process.stdout.write(`\x1b[35m🔥 Dev Hot Reload: ENABLED (watching UI files for instant updates)\x1b[0m\n`);
      }
      resolve({ server, port: actualPort, url, db, token: auth.token, fetch: createUiFetch(auth.token) });
    });
  });
};
