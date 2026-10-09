/**
 * Docs check resolver: does the command an invocation names exist?
 * Consults the command schema, the team command tree and the MCP action enum.
 * Checks names only: flags and arguments are never validated, and nothing runs.
 */
import { findCommandSchema } from '../commands-schema.js';
import { MCP_TOOLS } from '../mcp/tools.js';
import {
  TEAM_SUBCOMMANDS, TEAM_TASK_ACTIONS, TEAM_LOCK_ACTIONS, TEAM_FRONT_DOORS, CAPSULE_PREFIXES, BUILTIN_TOKENS
} from './command-tree.js';

const MCP_ACTIONS = MCP_TOOLS[0].inputSchema.properties.action.enum;
const PLACEHOLDER = /^[<\[{$]|\.\.\.|…|\|/;

const isPlaceholder = (word) => PLACEHOLDER.test(word);

const isKnownCommand = (word) => {
  const isSchemaCommand = findCommandSchema(word) !== null;
  const isCapsule = CAPSULE_PREFIXES.some((prefix) => word.startsWith(prefix));
  return isSchemaCommand || isCapsule || BUILTIN_TOKENS.includes(word);
};

const listOf = (names) => names.join(', ');

/** Check word `word` against `names`; a placeholder or missing word passes. */
const checkAgainst = (word, names, label) => {
  const isOpen = word === undefined || isPlaceholder(word);
  const isListed = names.includes(word);
  const passes = isOpen || isListed;
  return passes ? null : `unknown ${label} "${word}" (available: ${listOf(names)})`;
};

const checkTeam = (words) => {
  const subReason = checkAgainst(words[1], TEAM_SUBCOMMANDS, 'team command');
  if (subReason) return subReason;
  const taskReason = words[1] === 'task' ? checkAgainst(words[2], TEAM_TASK_ACTIONS, 'task action') : null;
  if (taskReason) return taskReason;
  const isLockFamily = words[1] === 'lock';
  const isFileTarget = isLockFamily && words[2] !== undefined && !TEAM_LOCK_ACTIONS.includes(words[2]);
  return isLockFamily && !isFileTarget ? checkAgainst(words[2], TEAM_LOCK_ACTIONS, 'lock action') : null;
};

const checkHelpTarget = (words) => {
  const target = words[1];
  const isOpen = target === undefined || isPlaceholder(target);
  return isOpen || isKnownCommand(target) ? null : `unknown command "${target}" (chemx help lists commands)`;
};

const checkCli = (words) => {
  const first = words[0];
  const isOpen = first === undefined || isPlaceholder(first);
  if (isOpen) return null;
  if (!isKnownCommand(first)) return `unknown command "${first}" (chemx help lists commands)`;
  const isTeam = TEAM_FRONT_DOORS.includes(first);
  if (isTeam) return checkTeam(words);
  return first === 'help' ? checkHelpTarget(words) : null;
};

const checkMcp = (action) => {
  const isListed = MCP_ACTIONS.includes(action);
  return isListed ? null : `unknown MCP action "${action}" (see action: "help")`;
};

/** @returns {string|null} why the invocation fails, or null when its names all exist */
export const resolveInvocation = (invocation) => {
  const isMcp = invocation.kind === 'mcp';
  return isMcp ? checkMcp(invocation.action) : checkCli(invocation.words);
};
