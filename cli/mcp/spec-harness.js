// Test-only helpers for driving the stdio MCP server through in-memory pipes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { startStdioServer } from './server.js';
import { scheduleTimeout } from '../timers.js';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const makeFixtureProject = (files = {}, marker = '.chemxrc') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g3-'));
  const hasMarker = Boolean(marker);
  if (hasMarker) fs.writeFileSync(path.join(root, marker), '{}\n');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
};

export const startPipeServer = (options = {}) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  const waiters = [];
  let buffered = '';
  output.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const frame = JSON.parse(line);
      frames.push(frame);
      for (const waiter of [...waiters]) {
        const isMatch = waiter.predicate(frame);
        if (isMatch) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(frame);
        }
      }
    }
  });
  const server = startStdioServer({ ...options, input, output });
  const send = (message) => input.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  const next = (predicate, timeoutMs = 5000) => {
    const seen = frames.find(predicate);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const cancelTimeout = scheduleTimeout(() => reject(new Error('timed out waiting for frame')), timeoutMs);
      waiters.push({ predicate, resolve: (frame) => { cancelTimeout(); resolve(frame); } });
    });
  };
  const close = () => { server.rl.close(); input.end(); };
  return { server, send, next, frames, close };
};

export const byId = (id) => (frame) => frame.id === id && !('method' in frame);

export const textOf = (response) => (response.result?.content || []).map((c) => c.text).join('\n');
