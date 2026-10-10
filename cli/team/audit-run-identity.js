// audit-run section "subagent acted as orchestrator" (#4562). A workflow agent's chemx call that
// changes shared state (claim, lock, write, commit, verify) and names no identity resolves to the
// CHEMX_AGENT_ID its orchestrator exported through $CLAUDE_ENV_FILE. Guaranteed: such a call in the
// transcript is listed, also one that names the orchestrator's own handle. Not guaranteed: whether the
// env really held that id, read-only calls, nor calls routed through MCP (only Bash chemx calls are read).

import { isActingChemxArgs } from '../hooks/session-identity.js';

const AS_FLAG = /^--as(?:=\S|$)/;
const IDENTITY_ASSIGN = /^CHEMX_AGENT_ID=\S/;
const COMMAND_LIMIT = 200;

const isIdentityExport = (inv) => inv.kind === 'shell' && inv.argv[0] === 'export' && inv.argv.slice(1).some((word) => IDENTITY_ASSIGN.test(word));
const hasAs = (argv) => argv.some((word, i) => AS_FLAG.test(word) && (word.includes('=') || (argv[i + 1] ?? '') !== ''));
const hasInlineId = (inv) => String(inv.vars?.CHEMX_AGENT_ID ?? '') !== '';
const asValue = (argv) => {
  const at = argv.findIndex((word) => AS_FLAG.test(word));
  const word = at < 0 ? '' : argv[at];
  return word.includes('=') ? word.slice(word.indexOf('=') + 1) : (argv[at + 1] ?? '');
};
const exportedValue = (inv) => (inv.argv.slice(1).find((word) => IDENTITY_ASSIGN.test(word)) ?? '').replace(/^CHEMX_AGENT_ID=/, '').replace(/^["']|["']$/g, '');
// The identity a call acts as: only this is compared with the orchestrator's handle. A handle merely
// mentioned (a handoff target, comment text) does not make the call anonymous (#5850).
const identityOf = (inv, exported, isChemx) => [String(inv.vars?.CHEMX_AGENT_ID ?? ''), isChemx ? asValue(inv.argv) : '', exported ?? ''].filter(Boolean);
const HELP_FLAG = /^(?:--help|-h|--version)$/;
// Read-only shapes the audit skips: --help/--version, and `test --changed` (#5850).
const isActing = (argv) => !argv.some((word) => HELP_FLAG.test(word)) && !(argv[0] === 'test' && argv.includes('--changed')) && isActingChemxArgs(argv);

const AS_VALUE = /^--as=(\S+)$/;
const withAt = (id) => (String(id).startsWith('@') ? String(id) : `@${id}`);

// The explicit identity a Bash chemx call names, from --as, an inline CHEMX_AGENT_ID=, or an earlier export in the transcript.
const explicitIdOf = (inv, exportedId) => {
  const asIndex = inv.argv.findIndex((word) => word === '--as');
  const asEquals = inv.argv.map((word) => word.match(AS_VALUE)?.[1]).find(Boolean);
  const spaced = asIndex >= 0 ? inv.argv[asIndex + 1] : undefined;
  const id = asEquals ?? spaced ?? (String(inv.vars?.CHEMX_AGENT_ID ?? '') || exportedId);
  return id ? withAt(id) : null;
};

const exportedIdOf = (inv) => inv.argv.slice(1).map((word) => word.match(/^CHEMX_AGENT_ID=(\S+)$/)?.[1]).find(Boolean) ?? null;

/**
 * Rows { at, command, identity } for state-changing Bash chemx calls whose explicit identity is not the agent's own
 * handle (#5740). Guaranteed: a call naming a different handle through --as, an inline CHEMX_AGENT_ID= or an earlier
 * export is listed; the orchestrator handle is left to anonymousActingCalls. Not guaranteed: calls without any
 * identity, MCP calls, or an identity held in a shell variable.
 */
export const actedAsOtherHandle = (invs, ownHandle, inheritedHandle = null) => {
  const rows = [];
  let exportedId = null;
  for (const inv of invs) {
    if (isIdentityExport(inv)) exportedId = exportedIdOf(inv) ? withAt(exportedIdOf(inv)) : exportedId;
    const isChemx = inv.kind === 'chemx' && inv.via === 'bash';
    const identity = isChemx ? explicitIdOf(inv, exportedId) : null;
    const isOther = identity !== null && identity !== withAt(ownHandle ?? '') && identity !== inheritedHandle;
    const isReported = isOther && inv.isDenied !== true && isActing(inv.argv) && Boolean(ownHandle);
    if (isReported) rows.push({ at: inv.at, command: inv.raw.replace(/\s+/g, ' ').slice(0, COMMAND_LIMIT), identity });
  }
  return rows;
};

/** Rows { at, command } for chemx calls of one agent that act without an identity of their own. */
export const anonymousActingCalls = (invs, inheritedHandle = null) => {
  const exportedIn = new Map();
  const rows = [];
  for (const inv of invs) {
    if (isIdentityExport(inv)) exportedIn.set(inv.raw, exportedValue(inv));
    const isChemx = inv.kind === 'chemx' && inv.via === 'bash';
    const isDenied = inv.isDenied === true;
    const hasIdentity = exportedIn.has(inv.raw) || hasInlineId(inv) || (isChemx && hasAs(inv.argv));
    const namesInherited = inheritedHandle !== null && identityOf(inv, exportedIn.get(inv.raw), isChemx).includes(inheritedHandle);
    const carries = hasIdentity && !namesInherited;
    const isAnonymous = isChemx && !isDenied && isActing(inv.argv) && !carries;
    if (isAnonymous) rows.push({ at: inv.at, command: inv.raw.replace(/\s+/g, ' ').slice(0, COMMAND_LIMIT) });
  }
  return rows;
};
