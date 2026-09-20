import http from 'node:http';
import { openIndexDb } from './search-db.js';
import { handleSwarmStatus } from './ui-handlers.js';
import { generateSwarmHtml } from './ui-html.js';
import { routeGet, routePost, parseJsonBody } from './ui-server-routes.js';

export const createUiServer = (cwd = process.cwd()) => {
  const db = openIndexDb(cwd);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';
    const isRootPath = pathname === '/' || pathname === '/index.html';
    const isFavicon = pathname === '/favicon.ico';
    const shouldServeHtml = isGet && isRootPath;
    const shouldServeFavicon = isGet && isFavicon;

    if (shouldServeHtml) {
      const state = handleSwarmStatus(db);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateSwarmHtml(state));
      return;
    }

    if (shouldServeFavicon) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (isGet) {
      const result = routeGet(req.url, db, cwd);
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
    }

    if (isPost) {
      try {
        const body = await parseJsonBody(req);
        const result = routePost(req.url, db, body, cwd);
        if (result) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return { server, db };
};

export const startUiServer = async (options = {}) => {
  const port = options.port !== undefined ? options.port : 4173;
  const cwd = options.cwd || process.cwd();
  const { server, db } = createUiServer(cwd);

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      if (options.isCli) {
        process.stdout.write(`\x1b[32m✔ Chemical X Live Swarm Web UI running at:\x1b[0m \x1b[36m${url}\x1b[0m\n`);
      }
      resolve({ server, port: actualPort, url, db });
    });
  });
};
