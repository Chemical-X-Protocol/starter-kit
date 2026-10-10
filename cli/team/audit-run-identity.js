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

/** Rows { at, command } for chemx calls of one agent that act without an identity of their own. */
export const anonymousActingCalls = (invs, inheritedHandle = null) => {
  const exportedIn = new Set();
  const rows = [];
  for (const inv of invs) {
    if (isIdentityExport(inv)) exportedIn.add(inv.raw);
    const isChemx = inv.kind === 'chemx' && inv.via === 'bash';
    const isDenied = inv.isDenied === true;
    const hasIdentity = exportedIn.has(inv.raw) || hasInlineId(inv) || (isChemx && hasAs(inv.argv));
    const namesInherited = inheritedHandle !== null && inv.raw.includes(inheritedHandle);
    const carries = hasIdentity && !namesInherited;
    const isAnonymous = isChemx && !isDenied && isActingChemxArgs(inv.argv) && !carries;
    if (isAnonymous) rows.push({ at: inv.at, command: inv.raw.replace(/\s+/g, ' ').slice(0, COMMAND_LIMIT) });
  }
  return rows;
};
