import { COMMANDS_SCHEMA, COMMAND_GROUPS, findCommandSchema } from './commands-schema.js';
import { isStdoutTty } from './terminal.js';

// Help text is generated from commands-schema.js. Top-level help stays under 1,500 bytes
// (help.spec.js); detail lives in `chemx help <command>` and `chemx <command> --help`.

const GROUP_TITLES = {
  search: 'Search and read',
  edit: 'Edit',
  verify: 'Verify',
  wrappers: 'Shell wrappers',
  agents: 'Agents',
  setup: 'Setup'
};
const HELP_TOKENS = new Set(['help', '--help', '-h']);
const SUBCOMMAND_HELP_OWNERS = new Set(['team', 'swarm', 'feed', 'tokens', 'telemetry', 'benchmark', 'ablation', 'memory']);
// Read-only commands whose positional is a lookup key: `chemx f help` lists paths containing "help".
// Writers and scaffolders keep `<command> help` as a help request so it never creates "help".
const LOOKUP_POSITIONAL_COMMANDS = new Set(['search', 'read', 'trace', 'backtrace', 'check', 'test', 'lint', 'audit', 'diff', 'log', 'pkg', 'ls', 'json', 'batch']);
// Flags that take the next token as their value, so a following -h is data (`chemx q -g -h`).
const VALUE_TAKING_FLAGS = new Set(['-g', '--literal', '-s', '--symbol', '-n']);
const NAME_COLUMN = 13;

const displayName = (entry) => {
  const usageToken = entry.usage.split(' ')[1] ?? entry.name;
  const isChemxUsage = entry.usage.startsWith('chemx ');
  const isPlainToken = /^[a-z:-]+$/.test(usageToken);
  return isChemxUsage && isPlainToken ? usageToken : entry.name;
};

export const formatTopLevelHelp = () => {
  const lines = ['chemx <command> [options]', 'chemx help <command>   flags and examples'];
  for (const group of COMMAND_GROUPS) {
    lines.push('', GROUP_TITLES[group]);
    for (const entry of COMMANDS_SCHEMA.filter((e) => e.group === group)) {
      lines.push(`  ${displayName(entry).padEnd(NAME_COLUMN)}${entry.brief}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const formatFlagRows = (flags) => {
  const width = Math.min(26, Math.max(...flags.map((f) => f.flag.length)) + 2);
  return flags.map((f) => `  ${f.flag.padEnd(width)}${f.desc}`);
};

export const formatCommandHelp = (entry) => {
  const otherNames = [entry.name, ...entry.aliases].filter((token) => token !== displayName(entry));
  const lines = ['USAGE', `  ${entry.usage}`];
  if (otherNames.length > 0) lines.push(`  aliases: ${otherNames.join(', ')}`);
  lines.push('', entry.summary);
  if (entry.description) lines.push(entry.description);
  if (entry.flags.length > 0) lines.push('', 'FLAGS', ...formatFlagRows(entry.flags));
  if (entry.examples.length > 0) lines.push('', 'EXAMPLES', ...entry.examples.map((eg) => `  ${eg}`));
  return `${lines.join('\n')}\n`;
};

const renderTtyBanner = async (title) => {
  const isHumanTerminal = isStdoutTty();
  if (!isHumanTerminal) return false;
  const { renderBanner } = await import('./banner.js');
  renderBanner(title);
  return true;
};

export const printCommandHelp = async (token) => {
  const entry = findCommandSchema(token);
  if (!entry) {
    process.stderr.write(`Unknown command "${token}". Run chemx help for the command list.\n`);
    process.exitCode = 1;
    return false;
  }
  await renderTtyBanner(`chemx ${displayName(entry)}`);
  process.stdout.write(formatCommandHelp(entry));
  return true;
};

export const printHelp = async (topicArgs = []) => {
  const topic = topicArgs.find((arg) => !HELP_TOKENS.has(arg));
  if (topic) return printCommandHelp(topic);
  await renderTtyBanner('Chemical X Protocol: CLI Usage & Reference');
  process.stdout.write(formatTopLevelHelp());
  return true;
};

/**
 * Decide whether `chemx <command> ...args` asks for that command's help.
 * Only options before `--` count, and -h right after a value-taking flag is that flag's value.
 * A lone `help` asks for help unless the command looks it up as data.
 * Commands that own subcommand help (team family) keep it unless the help flag directly follows the command.
 */
export const resolveCommandHelpTopic = (command, rawArgs) => {
  const rest = rawArgs.slice(1);
  const separatorIndex = rest.indexOf('--');
  const options = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  const isHelpFlagAt = (index) => ['--help', '-h'].includes(options[index]) && !VALUE_TAKING_FLAGS.has(options[index - 1]);
  const isLookupCommand = LOOKUP_POSITIONAL_COMMANDS.has(findCommandSchema(command)?.name);
  const isBareHelpWord = options.length === 1 && options[0] === 'help' && !isLookupCommand;
  const hasLeadingHelp = isHelpFlagAt(0) || isBareHelpWord;
  const ownsSubcommandHelp = SUBCOMMAND_HELP_OWNERS.has(command);
  if (ownsSubcommandHelp) return hasLeadingHelp ? command : null;
  const hasHelpAnywhere = options.some((_, index) => isHelpFlagAt(index)) || isBareHelpWord;
  return hasHelpAnywhere ? command : null;
};

export const printInitHelp = () => printCommandHelp('init');
export const printScaffoldHelp = () => printCommandHelp('create');
export const printSearchHelp = () => printCommandHelp('search');
