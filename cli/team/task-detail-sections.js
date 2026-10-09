/**
 * Chemical X Protocol: Task detail card sections.
 * Planning fields an agent needs from `task show`: sprint, MoSCoW, the description
 * (which holds acceptance criteria) and every dependency with its live status.
 */

import { getTask } from './team-db-tasks.js';

const WRAP_WIDTH = 76;
const INDENT = '    ';

export const wrapText = (text, width = WRAP_WIDTH) => {
  const wrapped = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const isBlank = words.length === 0;
    if (isBlank) {
      wrapped.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const isOverflow = candidate.length > width && Boolean(line);
      if (isOverflow) {
        wrapped.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    wrapped.push(line);
  }
  return wrapped;
};

export const resolveDependencyStates = (db, task) => {
  const ids = Array.isArray(task?.dependencies) ? task.dependencies : [];
  return ids.map((id) => {
    const dep = getTask(db, id);
    return { id: Number(id), title: dep?.title || '(missing task)', status: dep?.status || 'missing' };
  });
};

export const formatTaskBriefLines = (task, dependencyStates = []) => {
  const lines = [];
  const sprint = task.sprint_tag || '(none)';
  const moscow = task.moscow || '(none)';
  lines.push(`  \x1b[1mSprint:\x1b[0m   ${sprint} │ \x1b[1mMoSCoW:\x1b[0m ${moscow}`);

  const hasParent = Boolean(task.parent_id);
  if (hasParent) lines.push(`  \x1b[1mParent:\x1b[0m   #${task.parent_id}`);

  const hasDependencies = dependencyStates.length > 0;
  if (hasDependencies) {
    lines.push('  \x1b[1mDepends on:\x1b[0m');
    for (const dep of dependencyStates) {
      const mark = dep.status === 'done' ? '\x1b[32m✔\x1b[0m' : '\x1b[33m○\x1b[0m';
      lines.push(`${INDENT}${mark} #${dep.id} [${dep.status}] ${dep.title}`);
    }
  }

  const hasDescription = Boolean(task.description && task.description.trim());
  if (hasDescription) {
    lines.push('', '  \x1b[1mDescription:\x1b[0m');
    for (const line of wrapText(task.description.trim())) lines.push(line ? `${INDENT}${line}` : '');
  }
  return lines;
};

// Telemetry for the task card: measured tokens, or "unknown" for a done task never measured.
export const formatTelemetryLines = (task) => {
  const isMeasured = Boolean(task.telemetry_source);
  if (isMeasured) {
    const tok = Number(task.total_tokens || 0);
    return [`  \x1b[1mTelemetry:\x1b[0m ${tok.toLocaleString()} tokens │ \x1b[32m${Number(task.cost_usd || 0).toFixed(4)}\x1b[0m (${task.telemetry_source})`];
  }
  const isDone = task.status === 'done';
  return isDone ? ['  \x1b[1mTelemetry:\x1b[0m \x1b[90munknown (no --tokens or --log at completion)\x1b[0m'] : [];
};
