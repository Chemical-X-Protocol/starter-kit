/**
 * Chemical X Protocol: tool calls of one workflow agent, for `chemx team audit-run` (#2561).
 * usage-transcript.js keeps only Bash commands; the audit needs every tool call with its time and cwd,
 * the task text the agent was given, and the result it ended on. Reads the same agent-<id>.jsonl files.
 *
 * Limits: only what the transcript records is seen. A call that failed or was denied by a hook is still
 * a call here, and a tool_use with no result entry is counted as made.
 */

import { isGuardDenial } from './audit-run-bypass.js';

export const CHEMX_MCP_TOOL = 'mcp__chemical-x__chemx';
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']);
const OVERHEAD_TOOLS = new Set(['ToolSearch', 'StructuredOutput', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Monitor']);
// The harness header of the computed task turn; a relayed user-request turn only mentions the words in its body.
const TASK_MARKER = /^\s*\[Workflow harness\s*\W{1,3}\s*computed task\]/i;

const parseLines = (text) => {
  const entries = [];
  for (const line of String(text).split('\n')) {
    const isBlank = line.trim() === '';
    if (isBlank) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // chemx-allow: best-effort a torn final line of a live transcript is skipped, never guessed at
    }
  }
  return entries;
};

const blocksOf = (content) => (Array.isArray(content) ? content : []);

const textOf = (content) => {
  const isText = typeof content === 'string';
  if (isText) return content;
  return blocksOf(content).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
};

const stampOf = (entry) => {
  const at = Date.parse(entry.timestamp);
  return Number.isFinite(at) ? at : null;
};

export const isOverheadTool = (name) => OVERHEAD_TOOLS.has(name);
export const isFileTool = (name) => FILE_TOOLS.has(name);

// Ids of tool_use calls whose paired tool_result is a chemx guard or policy denial (they never ran).
const deniedIdsOf = (entries) => {
  const ids = new Set();
  for (const entry of entries.filter((e) => e.type === 'user')) {
    for (const block of blocksOf(entry.message?.content)) {
      const isResult = block?.type === 'tool_result';
      const isDenial = isResult && isGuardDenial(textOf(block.content));
      if (isDenial) ids.add(block.tool_use_id);
    }
  }
  return ids;
};

// Path chemx printed for an edit ("Patched <path>"), by tool_use id; preferred over the spelling the agent typed (#4543).
const PATCHED_LINE = /^\s*(?:✔\s*)?Patched\s+(\S+)/m;
const printedPathsOf = (entries) => {
  const paths = new Map();
  for (const entry of entries.filter((e) => e.type === 'user')) {
    for (const block of blocksOf(entry.message?.content)) {
      const match = block?.type === 'tool_result' ? PATCHED_LINE.exec(textOf(block.content)) : null;
      if (match) paths.set(block.tool_use_id, match[1].replace(/[.:,]+$/, ''));
    }
  }
  return paths;
};

// The task text: the user turn the harness computed (falls back to the first user turns).
const taskTextOf = (entries) => {
  const users = entries.filter((e) => e.type === 'user').slice(0, 4).map((e) => textOf(e.message?.content));
  const computed = users.find((t) => TASK_MARKER.test(t));
  return computed ?? users.join('\n');
};

/**
 * @returns {{ calls: Array<{ at: number|null, cwd: string, name: string, input: object }>,
 *   taskText: string, finalOutput: object|null, finalText: string }}
 */
export const readTranscriptCalls = (text) => {
  const entries = parseLines(text);
  const calls = [];
  const denied = deniedIdsOf(entries);
  const printed = printedPathsOf(entries);
  let finalOutput = null;
  let finalText = '';
  for (const entry of entries) {
    const isAssistant = entry.type === 'assistant';
    if (!isAssistant) continue;
    const blocks = blocksOf(entry.message?.content);
    const said = textOf(blocks).trim();
    if (said) finalText = said;
    for (const block of blocks) {
      const isUse = block?.type === 'tool_use';
      if (!isUse) continue;
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      const isFinal = block.name === 'StructuredOutput';
      if (isFinal) finalOutput = input;
      calls.push({ at: stampOf(entry), cwd: entry.cwd || '', name: block.name, input, isDenied: denied.has(block.id), printedPath: printed.get(block.id) ?? null });
    }
  }
  return { calls, taskText: taskTextOf(entries), finalOutput, finalText };
};
