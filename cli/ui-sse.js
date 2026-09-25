import { handleSwarmStatus } from './ui-handlers.js';

const clients = new Set();

export const handleSseConnection = (req, res, db) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  try {
    const initialState = handleSwarmStatus(db);
    res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  clients.add(res);

  const cleanup = () => {
    clients.delete(res);
  };

  req.on('close', cleanup);
  res.on('error', cleanup);
};

export const broadcastSseUpdate = (db) => {
  if (clients.size === 0 || !db) return;
  try {
    const state = handleSwarmStatus(db);
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch (err) {
        clients.delete(client);
      }
    }
  } catch (err) {
    process.stderr.write(`[SSE Broadcast Error] ${err.message}\n`);
  }
};

export const broadcastSseReload = () => {
  if (clients.size === 0) return;
  const payload = `event: reload\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (err) {
      clients.delete(client);
    }
  }
};

export const getConnectedSseClientsCount = () => clients.size;

export const closeSseHub = () => {
  for (const client of clients) {
    try {
      client.end();
    } catch (err) {
      clients.delete(client);
    }
  }
  clients.clear();
};
