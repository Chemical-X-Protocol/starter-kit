import { COMMANDS_SCHEMA, COMMAND_GROUPS, findCommandSchema } from './commands-schema.js';
import { renderTtyBanner } from './tty-banner.js';
import { optionsBeforeSeparator, isHelpFlagAt, hasHelpFlag } from './help-args.js';

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
// Commands whose positional is a search pattern or lookup key: `chemx f help` lists
// paths containing "help". Every other command reads a lone `help` as a help request,
// so readers, wrappers and writers never act on a path or revision named "help".
const LOOKUP_POSITIONAL_COMMANDS = new Set(['search', 'ls', 'pkg', 'trace', 'backtrace']);
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
  const options = optionsBeforeSeparator(rawArgs.slice(1));
  const isLookupCommand = LOOKUP_POSITIONAL_COMMANDS.has(findCommandSchema(command)?.name);
  const isBareHelpWord = options.length === 1 && options[0] === 'help' && !isLookupCommand;
  const hasLeadingHelp = isHelpFlagAt(options, 0) || isBareHelpWord;
  const ownsSubcommandHelp = SUBCOMMAND_HELP_OWNERS.has(command);
  if (ownsSubcommandHelp) return hasLeadingHelp ? command : null;
  const hasHelpAnywhere = hasHelpFlag(options) || isBareHelpWord;
  return hasHelpAnywhere ? command : null;
};

export const printInitHelp = () => printCommandHelp('init');
export const printScaffoldHelp = () => printCommandHelp('create');
export const printSearchHelp = () => printCommandHelp('search');
