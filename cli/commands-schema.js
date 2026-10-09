/**
 * Chemical X Protocol: Canonical Command Schema
 * Single source of truth for CLI commands, aliases, flags, descriptions, and examples.
 * Top-level `chemx help` lists `brief`; `chemx help <command>` and `chemx <command> --help`
 * render the full entry. Every routable command token must resolve to one entry here.
 */

import { READ_EDIT_COMMANDS } from './commands-schema-read-edit.js';
import { VERIFY_COMMANDS } from './commands-schema-verify.js';
import { OPS_COMMANDS } from './commands-schema-ops.js';

export const COMMAND_GROUPS = ['search', 'edit', 'verify', 'wrappers', 'agents', 'setup'];

export const COMMANDS_SCHEMA = [...READ_EDIT_COMMANDS, ...VERIFY_COMMANDS, ...OPS_COMMANDS];

const COMMAND_INDEX = new Map(
  COMMANDS_SCHEMA.flatMap((entry) => [entry.name, ...entry.aliases].map((token) => [token, entry]))
);

export const findCommandSchema = (token) => COMMAND_INDEX.get(token) ?? null;

// Every token the router accepts; index.js derives ALLOWED_COMMANDS from it.
export const ROUTABLE_COMMAND_TOKENS = [...COMMAND_INDEX.keys()];
