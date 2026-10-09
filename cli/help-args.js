// Help-flag detection shared by the router (help.js) and handlers that are also
// called directly (reader-cli.js). Only options before `--` count, and a -h right
// after a value-taking flag is that flag's value (`chemx q -g -h` searches for "-h").

const HELP_FLAGS = new Set(['--help', '-h']);
export const VALUE_TAKING_FLAGS = new Set(['-g', '--literal', '-s', '--symbol', '-n']);

export const optionsBeforeSeparator = (args) => {
  const separatorIndex = args.indexOf('--');
  return separatorIndex === -1 ? args : args.slice(0, separatorIndex);
};

export const isHelpFlagAt = (options, index) => HELP_FLAGS.has(options[index]) && !VALUE_TAKING_FLAGS.has(options[index - 1]);

export const hasHelpFlag = (args) => {
  const options = optionsBeforeSeparator(args);
  return options.some((_, index) => isHelpFlagAt(options, index));
};
