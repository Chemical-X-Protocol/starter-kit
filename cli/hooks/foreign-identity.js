// A dispatched agent naming another handle of its own run as its identity (#5740). #4545 and #4598 check that
// a chemx call carries an identity; this checks that the identity is the caller's. validation-5 repair:#4201
// released the builder's live lease by passing --as=<builder handle>.
// Guaranteed: for a call whose dispatch handle resolved, an explicit identity (an inline or exported
// CHEMX_AGENT_ID=, or --as) that is another handle of the same run is named, and the deny names the sanctioned
// path (`chemx team task handoff <id> <@to> --with-locks`, or waiting for the lease TTL).
// Not guaranteed: an identity of a handle outside the run, a handle held in a shell variable, an agent whose
// dispatch handle did not resolve, or an identity passed in a way the shell parser does not see.

import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';

const ASSIGN = /^CHEMX_AGENT_ID=(\S+)$/;
const AS_EQUALS = /^--as=(\S+)$/;
// `@polish-1-5740` and `@polish-1-4607-repair` both belong to run `polish-1`.
const RUN_OF = /^@?(.+?)-\d+(?:-[a-z][a-z-]*)?$/;

const unquote = (word) => String(word).replace(/^['"]|['"]$/g, '');

/** The run name a dispatch handle belongs to, or null. */
export const runOfHandle = (handle) => String(handle ?? '').match(RUN_OF)?.[1] ?? null;

const withAt = (id) => (String(id).startsWith('@') ? String(id) : `@${id}`);

const identitiesOfArgv = (argv, assigns) => {
  const found = [];
  for (const word of assigns) found.push(word.match(ASSIGN)?.[1]);
  const exported = argv[0] === 'export' ? argv.slice(1) : [];
  for (const word of exported) found.push(word.match(ASSIGN)?.[1]);
  argv.forEach((word, i) => {
    found.push(word.match(AS_EQUALS)?.[1]);
    const isSeparate = word === '--as';
    found.push(isSeparate ? argv[i + 1] : undefined);
  });
  return found.filter(Boolean).map((id) => withAt(unquote(id)));
};

/** Every explicit identity named by a chemx call (or an export) in the command, as `@handle`. */
export const explicitIdentities = (command) => {
  const found = [];
  for (const parsed of parseShell(String(command ?? '')).commands) {
    const isEmpty = parsed.argv.length === 0;
    const isExport = !isEmpty && parsed.argv[0] === 'export';
    const isChemx = !isEmpty && isChemxInvocation(resolveInvocation(parsed.argv));
    const named = isChemx || isExport ? identitiesOfArgv(parsed.argv, parsed.assigns) : [];
    found.push(...named);
  }
  return found;
};

/** The explicit identities in the command that are another handle of the same run as `ownHandle`. */
export const foreignRunIdentities = (command, ownHandle) => {
  const run = runOfHandle(ownHandle);
  const isForeign = (id) => id !== ownHandle && run !== null && runOfHandle(id) === run;
  return [...new Set(explicitIdentities(command).filter(isForeign))];
};

export const foreignIdentityDenyReason = (ownHandle, foreign) => `chemx identity: this agent is dispatched as ${ownHandle}, but this call acts as ${foreign.join(', ')}, another handle of the same run, so its leases and claims would be changed under that handle. `
  + `Use your own handle (--as=${ownHandle}). To get a file another handle of your run leases, wait for the lease (chemx wait --lock-free=<file>) or ask that handle's task owner to run \`chemx team task handoff <id> ${ownHandle} --as=<them> --with-locks\`. `
  + 'Resolved from this agent\'s dispatch record; calls that name a handle outside the run are not checked.';
