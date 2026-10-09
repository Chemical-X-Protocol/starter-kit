/**
 * Chemical X Protocol: tool calls of one workflow agent, for `chemx team audit-run` (#2561).
 * usage-transcript.js keeps only Bash commands; the audit needs every tool call with its time and cwd,
 * the task text the agent was given, and the result it ended on. Reads the same agent-<id>.jsonl files.
 *
 * Limits: only what the transcript records is seen. A call that failed or was denied by a hook is still
 * a call here, and a tool_use with no result entry is counted as made.
 */

export const CHEMX_MCP_TOOL = 'mcp__chemical-x__chemx';
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']);
const OVERHEAD_TOOLS = new Set(['ToolSearch', 'StructuredOutput', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Monitor']);
const TASK_MARKER = 'computed task';

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

// The task text: the user turn the harness computed (falls back to the first user turns).
const taskTextOf = (entries) => {
  const users = entries.filter((e) => e.type === 'user').slice(0, 4).map((e) => textOf(e.message?.content));
  const computed = users.find((t) => t.includes(TASK_MARKER));
  return computed ?? users.join('\n');
};

/**
 * @returns {{ calls: Array<{ at: number|null, cwd: string, name: string, input: object }>,
 *   taskText: string, finalOutput: object|null, finalText: string }}
 */
export const readTranscriptCalls = (text) => {
  const entries = parseLines(text);
  const calls = [];
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
      calls.push({ at: stampOf(entry), cwd: entry.cwd || '', name: block.name, input });
    }
  }
  return { calls, taskText: taskTextOf(entries), finalOutput, finalText };
};
