// tools/call orchestration: scope every call (and every batch item), run it, and wrap the result.
import { executeMcpTool } from './tools.js';
import { resolveCallScope, extractCallTarget, bindToRoot } from './call-scope.js';
import { isBatchCall, expandBatchItems, runBatchItems, batchEnvelope } from './batch.js';
import { toEnvelope, errorEnvelope, scopeLine, textItem } from './envelope.js';

const BOOT_HINT = 'chemx: no root was declared, so the server start directory was used. Pass projectRoot to target another project.';
const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);

const describeError = (err) => (err instanceof Error ? err.message : String(err));

export const createToolCaller = ({ scopeInputs, staleness = null }) => {
  let hasShownBootHint = false;

  const decorate = (envelope, scope) => {
    const isBoot = scope?.rootSource === 'boot';
    const shouldHint = isBoot && (envelope.isError || !hasShownBootHint);
    if (shouldHint) hasShownBootHint = true;
    const staleNotice = staleness?.check() ?? null;
    const trailer = [
      scopeLine(scope),
      shouldHint ? textItem(BOOT_HINT) : null,
      staleNotice ? textItem(staleNotice) : null
    ].filter(Boolean);
    return { ...envelope, content: [...envelope.content, ...trailer] };
  };

  const scopeFor = async (toolName, toolArgs) => resolveCallScope({ target: extractCallTarget(toolName, toolArgs), ...(await scopeInputs()) });

  const callBatch = async (toolName, toolArgs) => {
    const items = expandBatchItems(toolArgs);
    const scoped = [];
    for (const item of items) {
      const scope = item.invalid ? { ok: false, error: item.invalid } : await scopeFor('chemx', item.args);
      scoped.push({ ...item, scope });
    }
    const refusals = scoped.filter((item) => !item.scope.ok).map((item) => `item ${item.index + 1} (${item.label}): ${item.scope.error}`);
    const isRefused = refusals.length > 0;
    const knownScope = scoped.find((item) => item.scope.root)?.scope ?? null;
    if (isRefused) return decorate(errorEnvelope(`Refusing batch; no item ran.\n${refusals.join('\n')}`), knownScope);
    const isEmpty = scoped.length === 0;
    if (isEmpty) return decorate(errorEnvelope('Empty batch: nothing ran.'), null);
    const outcome = await runBatchItems(scoped, (item) => executeMcpTool(toolName, bindToRoot('chemx', item.args, item.scope.root), item.scope.root));
    return decorate(batchEnvelope(outcome), scoped[0].scope);
  };

  return async (toolName, toolArgs) => {
    const isBatch = MASTER_TOOL_NAMES.has(toolName) && isBatchCall(toolArgs);
    if (isBatch) return callBatch(toolName, toolArgs);
    const scope = await scopeFor(toolName, toolArgs);
    if (!scope.ok) return decorate(errorEnvelope(`Error executing tool "${toolName}": ${scope.error}`), scope);
    try {
      const output = await executeMcpTool(toolName, bindToRoot(toolName, toolArgs, scope.root), scope.root);
      return decorate(toEnvelope(output), scope);
    } catch (err) {
      return decorate(errorEnvelope(`Error executing tool "${toolName}": ${describeError(err)}`), scope);
    }
  };
};
