// tools/call orchestration: scope every call (and every batch item), run it, and wrap the result.
import { executeMcpTool } from './tools.js';
import { resolveCallScope, extractCallTarget, bindToRoot, isMutatingCall } from './call-scope.js';
import { prepareExecution } from './stale-exec.js';
import { createFreshRunner } from './fresh-runner.js';
import { isBatchCall, expandBatchItems, runBatchItems, batchEnvelope } from './batch.js';
import { toEnvelope, errorEnvelope, scopeLine, textItem } from './envelope.js';

const BOOT_HINT = 'chemx: no root was declared, so the server start directory was used. Pass projectRoot to target another project.';
const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);

const describeError = (err) => (err instanceof Error ? err.message : String(err));

export const createToolCaller = ({ scopeInputs, staleness = null, runFresh = createFreshRunner() }) => {
  let hasShownBootHint = false;

  // A stale server runs each call in a fresh process; banners (own line, top of the result) say so.
  const prepare = async (isMutating) => prepareExecution({
    staleness, runFresh, runLoaded: executeMcpTool, isMutating, env: (await scopeInputs()).env
  });
  const isMutatingArgs = (toolName, args) => isMutatingCall(extractCallTarget(toolName, args));
  const bannerItems = (banners) => banners.map((text) => textItem(`${text}\n`));

  const decorate = (envelope, scope, banners = []) => {
    const isBoot = scope?.rootSource === 'boot';
    const shouldHint = isBoot && (envelope.isError || !hasShownBootHint);
    if (shouldHint) hasShownBootHint = true;
    const staleNotice = staleness?.check() ?? null;
    const trailer = [
      scopeLine(scope),
      shouldHint ? textItem(`\n${BOOT_HINT}`) : null,
      staleNotice ? textItem(`\n${staleNotice}`) : null
    ].filter(Boolean);
    return { ...envelope, content: [...bannerItems(banners), ...envelope.content, ...trailer] };
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
    // An item refused before scoping (nested batch, non-object) still reports the batch-level root.
    const batchScope = async () => scoped.find((item) => item.scope.root)?.scope ?? await scopeFor('chemx', { projectRoot: toolArgs.projectRoot });
    if (isRefused) return decorate(errorEnvelope(`Refusing batch; no item ran.\n${refusals.join('\n')}`), await batchScope());
    const isEmpty = scoped.length === 0;
    if (isEmpty) return decorate(errorEnvelope('Empty batch: nothing ran.'), await batchScope());
    const isMutating = scoped.some((item) => isMutatingArgs('chemx', item.args));
    const { execute, banners } = await prepare(isMutating);
    const outcome = await runBatchItems(scoped, (item) => execute(toolName, bindToRoot('chemx', item.args, item.scope.root), item.scope.root));
    return decorate(batchEnvelope(outcome), scoped[0].scope, banners);
  };

  return async (toolName, toolArgs) => {
    const isBatch = MASTER_TOOL_NAMES.has(toolName) && isBatchCall(toolArgs);
    if (isBatch) return callBatch(toolName, toolArgs);
    const scope = await scopeFor(toolName, toolArgs);
    const isScopeRefused = !Boolean(scope.ok);
    if (isScopeRefused) return decorate(errorEnvelope(`Error executing tool "${toolName}": ${scope.error}`), scope);
    const { execute, banners } = await prepare(isMutatingArgs(toolName, toolArgs));
    try {
      const output = await execute(toolName, bindToRoot(toolName, toolArgs, scope.root), scope.root);
      return decorate(toEnvelope(output), scope, banners);
    } catch (err) {
      return decorate(errorEnvelope(`Error executing tool "${toolName}": ${describeError(err)}`), scope, banners);
    }
  };
};
