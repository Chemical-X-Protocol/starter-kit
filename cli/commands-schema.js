/**
 * Chemical X Protocol: Canonical Command Schema
 * Single source of truth for CLI commands, aliases, flags, descriptions, and examples.
 * Top-level `chemx help` lists `brief`; `chemx help <command>` and `chemx <command> --help`
 * render the full entry. Every routable command token must resolve to one entry here.
 */

import { SEARCH_COMMANDS } from './commands-schema-search.js';
import { EDIT_COMMANDS } from './commands-schema-edit.js';
import { VERIFY_COMMANDS } from './commands-schema-verify.js';
import { VERIFY_MORE_COMMANDS } from './commands-schema-badge.js';
import { WRAPPER_COMMANDS } from './commands-schema-wrappers.js';
import { OPS_COMMANDS } from './commands-schema-ops.js';
import { SETUP_COMMANDS } from './commands-schema-setup.js';
import { COMMIT_COMMANDS } from './commands-schema-commit.js';
import { PATTERNS_COMMANDS } from './commands-schema-patterns.js';
import { HOST_COMMANDS } from './commands-schema-host.js';
import { REPORT_COMMANDS } from './commands-schema-report.js';

export const COMMAND_GROUPS = ['search', 'edit', 'verify', 'wrappers', 'agents', 'setup'];

export const COMMANDS_SCHEMA = [...SEARCH_COMMANDS, ...EDIT_COMMANDS, ...VERIFY_COMMANDS, ...VERIFY_MORE_COMMANDS, ...WRAPPER_COMMANDS, ...OPS_COMMANDS, ...SETUP_COMMANDS, ...COMMIT_COMMANDS, ...PATTERNS_COMMANDS, ...REPORT_COMMANDS, ...HOST_COMMANDS];

const COMMAND_INDEX = new Map(
  COMMANDS_SCHEMA.flatMap((entry) => [entry.name, ...entry.aliases].map((token) => [token, entry]))
);

export const findCommandSchema = (token) => COMMAND_INDEX.get(token) ?? null;

// Every token the router accepts; index.js derives ALLOWED_COMMANDS from it.
export const ROUTABLE_COMMAND_TOKENS = [...COMMAND_INDEX.keys()];
