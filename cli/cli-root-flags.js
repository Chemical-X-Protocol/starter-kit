/**
 * Which long flags of a command take the next word as their value, read from the command schema.
 * cli-root.js uses it so a value that spells `--root` (a patch target, a comment) is never taken for the flag.
 * Kept apart from cli-root.js because that file must load without the command schema.
 */
import { findCommandSchema } from './commands-schema.js';
import { knownLongFlags } from './commands/unknown-flags.js';

const NO_FLAGS = new Set();

/** @returns {Set<string>} the long flags that take a value, empty for a command with no schema entry */
export const schemaValueFlags = (command) => {
  const entry = findCommandSchema(command);
  if (!entry) return NO_FLAGS;
  const takesValue = ([, hasValue]) => hasValue;
  return new Set([...knownLongFlags(entry)].filter(takesValue).map(([flag]) => flag));
};
