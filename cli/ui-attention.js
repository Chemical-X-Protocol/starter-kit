import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The current user's Antigravity history dir; never a hard-coded home path.
export const resolveAntigravityTranscript = (conversationId, homeDir = os.homedir()) =>
  path.join(homeDir, '.gemini', 'antigravity', 'brain', path.basename(conversationId), '.system_generated', 'logs', 'transcript.jsonl');

export const scanAttentionItems = (db, cwd = process.cwd()) => {
  const isAgRunning = Boolean(process.env.ANTIGRAVITY_AGENT === '1' || process.env.ANTIGRAVITY_LS_ADDRESS);
  const conversationId = process.env.ANTIGRAVITY_CONVERSATION_ID || null;
  const items = [];

  if (conversationId) {
    const transcriptPath = resolveAntigravityTranscript(conversationId);
    try {
      const hasTranscript = fs.existsSync(transcriptPath);
      if (hasTranscript) {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
          const step = JSON.parse(lines[i]);
          const hasToolCalls = Boolean(step.tool_calls);
          if (hasToolCalls) {
            for (const tc of step.tool_calls) {
              const name = tc.name || tc.tool_name;
              const hasObjectArguments = typeof tc.arguments === 'object';
              const args = hasObjectArguments ? tc.arguments : (JSON.parse(tc.argumentsJson || tc.arguments || '{}'));
              const isQuestion = name === 'ask_question';
              const isElevatedCommand = Boolean(name === 'run_command' && args.BypassSandbox);
              if (isQuestion) {
                const firstQuestion = args.questions?.[0];
                items.push({ id: `ag-q-${step.step_index}`, source: 'Antigravity Prompt', title: firstQuestion?.question || 'Agent Question', detail: firstQuestion?.options?.join(', ') || 'Choice Required', type: 'prompt', conversationId, timestamp: step.created_at });
              } else if (isElevatedCommand) {
                items.push({ id: `ag-cmd-${step.step_index}`, source: 'Sandbox Elevation', title: `Command: ${args.CommandLine}`, detail: `Directory: ${args.Cwd || cwd}`, type: 'command', conversationId, timestamp: step.created_at });
              }
            }
          }
        }
      }
    } catch { // chemx-allow: best-effort the Antigravity transcript is optional and may be mid-write or malformed
    }
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
    } catch { // chemx-allow: best-effort older index databases may lack the agent_tasks or file_lock_queue tables
    }
  }

  return { success: true, antigravityRunning: isAgRunning, conversationId, items, pendingCount: items.length };
};

export const confirmAttentionItem = (db, itemId = '', action = 'approve') => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const now = Date.now();

  const isTaskItem = itemId.startsWith('task-');
  if (isTaskItem) {
    const taskId = itemId.replace('task-', '');
    const newStatus = action === 'approve' ? 'in_progress' : 'cancelled';
    db.prepare('UPDATE agent_tasks SET status = ? WHERE id = ?').run(newStatus, taskId);
    db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@user', 'task_approval', ?)").run(now, `Task #${taskId} ${action}d by user`);
    return { success: true, message: `Task #${taskId} marked as ${newStatus}` };
  }

  const isLockItem = itemId.startsWith('lock-');
  if (isLockItem) {
    const lockId = itemId.replace('lock-', '');
    const isApproval = action === 'approve';
    if (isApproval) {
      db.prepare("UPDATE file_lock_queue SET status = 'granted' WHERE id = ?").run(lockId);
    } else {
      db.prepare("DELETE FROM file_lock_queue WHERE id = ?").run(lockId);
    }
    return { success: true, message: `Lock request #${lockId} ${action}d` };
  }

  db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@user', 'user_action', ?)").run(now, `Confirmed item ${itemId} with action: ${action}`);
  return { success: true, message: `Attention item ${itemId} confirmed` };
};
