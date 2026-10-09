// Wire format between a stale MCP server and its one-shot fresh process.
export const RESULT_MARK = '@@chemx-fresh-result@@';

// The last marked line of the child's stdout, parsed; null when there is none.
export const parseFreshResult = (stdout) => {
  const marked = String(stdout).split('\n').filter((line) => line.startsWith(RESULT_MARK));
  const last = marked.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(last.slice(RESULT_MARK.length));
  } catch {
    return null;
  }
};

const tail = (text) => String(text).trim().split('\n').slice(-3).join(' | ');

// Child exit to { kind: 'ok', output } | { kind: 'error', error } | { kind: 'load', message }.
export const classifyFreshExit = ({ stdout, stderr, code }) => {
  const parsed = parseFreshResult(stdout);
  const hasResult = parsed !== null;
  const isLoadFailure = hasResult && Boolean(parsed.loadFailure);
  const isToolError = hasResult && Boolean(parsed.error);
  if (!hasResult) return { kind: 'load', message: `fresh process exited ${code} without a result: ${tail(stderr) || 'no stderr'}` };
  if (isLoadFailure) return { kind: 'load', message: parsed.loadFailure };
  if (isToolError) return { kind: 'error', error: parsed.error };
  return { kind: 'ok', output: parsed.output };
};
