// One-shot executor for a stale MCP server: runs one tool call with the code on disk.
// stdin: { toolName, toolArgs, root } as JSON. stdout: one line, RESULT_MARK + JSON of
// { output } | { error } | { loadFailure }. loadFailure means the code on disk did not load.
import { RESULT_MARK, LOADED_MARK } from './fresh-protocol.js';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
};

const describe = (err) => (err instanceof Error ? err.message : String(err));
const emit = (payload) => process.stdout.write(`\n${RESULT_MARK}${JSON.stringify(payload)}\n`);

const run = async () => {
  const request = JSON.parse(await readStdin());
  let executeMcpTool = null;
  try {
    ({ executeMcpTool } = await import('./tools.js'));
  } catch (err) {
    emit({ loadFailure: describe(err) });
    return;
  }
  process.stdout.write(`\n${LOADED_MARK}\n`);
  try {
    const output = await executeMcpTool(request.toolName, request.toolArgs, request.root);
    emit({ output: output ?? null });
  } catch (err) {
    emit({ error: describe(err) });
  }
};

await run();
process.exit(0);
