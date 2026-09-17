import fs from 'node:fs';
import path from 'node:path';

export const scanAttentionItems = (db, cwd = process.cwd()) => {
  const isAgRunning = Boolean(process.env.ANTIGRAVITY_AGENT === '1' || process.env.ANTIGRAVITY_LS_ADDRESS);
  const conversationId = process.env.ANTIGRAVITY_CONVERSATION_ID || null;
  const items = [];

  if (conversationId) {
    const transcriptPath = path.join('/home/xopher/.gemini/antigravity/brain', conversationId, '.system_generated/logs/transcript.jsonl');
    try {
      if (fs.existsSync(transcriptPath)) {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
          const step = JSON.parse(lines[i]);
          if (step.tool_calls) {
            for (const tc of step.tool_calls) {
              const name = tc.name || tc.tool_name;
              const args = typeof tc.arguments === 'object' ? tc.arguments : (JSON.parse(tc.argumentsJson || tc.arguments || '{}'));
              if (name === 'ask_question') {
                items.push({ id: `ag-q-${step.step_index}`, source: 'Antigravity Prompt', title: args.questions?.[0]?.question || 'Agent Question', detail: args.questions?.[0]?.options?.join(', ') || 'Choice Required', type: 'prompt', conversationId, timestamp: step.created_at });
              } else if (name === 'run_command' && args.BypassSandbox) {
                items.push({ id: `ag-cmd-${step.step_index}`, source: 'Sandbox Elevation', title: `Command: ${args.CommandLine}`, detail: `Directory: ${args.Cwd || cwd}`, type: 'command', conversationId, timestamp: step.created_at });
              }
            }
          }
        }
      }
    } catch {}
  }

  if (db) {
    try {
      const pendingTasks = db.prepare("SELECT id, title, status, assigned_agent_id FROM agent_tasks WHERE status IN ('pending_approval', 'blocked')").all();
      for (const t of pendingTasks) {
        items.push({ id: `task-${t.id}`, source: 'Swarm Task', title: t.title, detail: `Status: ${t.status} • Agent: ${t.assigned_agent_id || 'Unassigned'}`, type: 'task', timestamp: new Date().toISOString() });
      }

      const waitingLocks = db.prepare("SELECT id, file_path, agent_id, purpose FROM file_lock_queue WHERE status = 'waiting'").all();
      for (const l of waitingLocks) {
        items.push({ id: `lock-${l.id}`, source: 'Lock Queue Contention', title: `Lock Request: ${l.file_path}`, detail: `Agent: ${l.agent_id} • Purpose: ${l.purpose || 'None'}`, type: 'lock', timestamp: new Date().toISOString() });
      }
    } catch {}
  }

  return { success: true, antigravityRunning: isAgRunning, conversationId, items, pendingCount: items.length };
};

export const confirmAttentionItem = (db, itemId = '', action = 'approve') => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const now = Date.now();

  if (itemId.startsWith('task-')) {
    const taskId = itemId.replace('task-', '');
    const newStatus = action === 'approve' ? 'in_progress' : 'cancelled';
    db.prepare('UPDATE agent_tasks SET status = ? WHERE id = ?').run(newStatus, taskId);
    db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@user', 'task_approval', ?)").run(now, `Task #${taskId} ${action}d by user`);
    return { success: true, message: `Task #${taskId} marked as ${newStatus}` };
  }

  if (itemId.startsWith('lock-')) {
    const lockId = itemId.replace('lock-', '');
    if (action === 'approve') {
      db.prepare("UPDATE file_lock_queue SET status = 'granted' WHERE id = ?").run(lockId);
    } else {
      db.prepare("DELETE FROM file_lock_queue WHERE id = ?").run(lockId);
    }
    return { success: true, message: `Lock request #${lockId} ${action}d` };
  }

  db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@user', 'user_action', ?)").run(now, `Confirmed item ${itemId} with action: ${action}`);
  return { success: true, message: `Attention item ${itemId} confirmed` };
};
