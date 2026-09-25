import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startUiServer } from './ui-server.js';
import { closeSseHub } from './ui-sse.js';

const readNextSseEvent = async (reader) => {
  let buffer = '';
  const decoder = new TextDecoder();
  while (!buffer.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const eventText = buffer.split('\n\n')[0].replace(/^data:\s*/, '').trim();
  return JSON.parse(eventText);
};

describe('UI Server-Sent Events (SSE) Stream', () => {
  it('serves text/event-stream headers and initial state snapshot', async () => {
    const running = await startUiServer({ port: 0 });
    try {
      const res = await fetch(`http://localhost:${running.port}/api/swarm/events`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
      assert.strictEqual(res.headers.get('cache-control'), 'no-cache, no-transform');

      const reader = res.body?.getReader();
      assert.ok(reader);
      const payload = await readNextSseEvent(reader);
      assert.strictEqual(payload.success, true);
      assert.ok(Array.isArray(payload.agents));
      await reader.cancel();
    } finally {
      running.server.close();
      closeSseHub();
    }
  });

  it('broadcasts real-time updates when tasks or events mutate', async () => {
    const running = await startUiServer({ port: 0 });
    let taskId = null;
    try {
      const res = await fetch(`http://localhost:${running.port}/api/swarm/events`);
      const reader = res.body?.getReader();
      assert.ok(reader);

      // Consume initial frame
      await readNextSseEvent(reader);

      // Trigger a POST mutation
      const createRes = await fetch(`http://localhost:${running.port}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'SSE Test Task', tier: 'atom' })
      });
      assert.strictEqual(createRes.status, 200);
      const createData = await createRes.json();
      taskId = createData.task?.id;

      // Next frame receives broadcast update
      const payload = await readNextSseEvent(reader);
      assert.strictEqual(payload.success, true);
      assert.ok(payload.tasks.some((t) => t.id === taskId));

      await reader.cancel();
    } finally {
      if (taskId) {
        running.db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(taskId);
      }
      running.server.close();
      closeSseHub();
    }
  });

  it('broadcasts reload event on broadcastSseReload', async () => {
    const running = await startUiServer({ port: 0 });
    try {
      const res = await fetch(`http://localhost:${running.port}/api/swarm/events`);
      const reader = res.body?.getReader();
      assert.ok(reader);
      await readNextSseEvent(reader);

      const { broadcastSseReload } = await import('./ui-sse.js');
      broadcastSseReload();

      let buffer = '';
      const decoder = new TextDecoder();
      while (!buffer.includes('event: reload')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      assert.ok(buffer.includes('event: reload'));
      await reader.cancel();
    } finally {
      running.server.close();
      closeSseHub();
    }
  });
});
