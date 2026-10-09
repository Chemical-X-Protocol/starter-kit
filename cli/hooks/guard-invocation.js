// Resolve what a parsed simple command actually runs: strip wrappers (env, timeout, nice, xargs...)
// and package-manager launchers (npx, pnpm exec, npm run...) down to { tool, args }.

const baseName = (word) => String(word ?? '').split('/').pop();

const CHEMX_BINS = new Set(['chemx', 'cx', 'cmx', 'chem-x', 'chemical-x', 'create-chemx']);
const CHEMX_SCRIPT = /(?:^|\/)cli\/(?:index|hooks\/entry)\.js$/;

// Wrapper -> option flags that consume the following word.
const WRAPPERS = {
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  nice: new Set(['-n', '--adjustment']),
  nohup: new Set(),
  command: new Set(),
  exec: new Set(['-a']),
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U']),
  stdbuf: new Set(['-i', '-o', '-e']),
  xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-a', '-E', '-s', '--max-args', '--max-procs', '--delimiter']),
  time: new Set(['-f', '-o']),
};
const POSITIONAL_AFTER_OPTIONS = { timeout: 1 };
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const PM_VALUE_FLAGS = new Set(['-C', '--dir', '--filter', '-F', '--prefix', '-w', '--workspace', '--cwd', '-p', '--package']);
const PM_EXEC = new Set(['exec', 'dlx', 'x']);
const PM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
const NPM_ALIASES = { t: 'test', tst: 'test' };
const LAUNCHERS = new Set(['npx', 'pnpx', 'bunx']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

// `chemx@26.10.8` and `@chemx/starter-kit@1.2.3` name the chemx package; strip the version pin.
const packageToTool = (spec = '') => {
  const unversioned = spec.replace(/(.)@[^/@]*$/, '$1');
  const isKitPackage = unversioned === '@chemx/starter-kit';
  return isKitPackage ? 'chemx' : baseName(unversioned);
};

const skipOptions = (argv, start, valueFlags) => {
  let index = start;
  while (index < argv.length && argv[index].startsWith('-')) {
    const flag = argv[index];
    const takesValue = valueFlags.has(flag);
    index += takesValue ? 2 : 1;
    const isEndOfOptions = flag === '--';
    if (isEndOfOptions) break;
  }
  return index;
};

const stripWrappers = (argv) => {
  let rest = argv;
  for (let guard = 0; guard < 8; guard += 1) {
    const name = baseName(rest[0]);
    const isWrapper = Object.hasOwn(WRAPPERS, name);
    if (!isWrapper) return rest;
    let index = skipOptions(rest, 1, WRAPPERS[name]);
    while (name === 'env' && ENV_ASSIGNMENT.test(rest[index] ?? '')) index += 1;
    index += POSITIONAL_AFTER_OPTIONS[name] ?? 0;
    rest = rest.slice(index);
  }
  return rest;
};

const resolvePackageManager = (name, argv) => {
  const isLauncher = LAUNCHERS.has(name);
  if (isLauncher) {
    const index = skipOptions(argv, 1, PM_VALUE_FLAGS);
    return { tool: packageToTool(argv[index]), args: argv.slice(index + 1), via: name };
  }
  let index = skipOptions(argv, 1, PM_VALUE_FLAGS);
  const isYarnWorkspace = name === 'yarn' && argv[index] === 'workspace';
  if (isYarnWorkspace) index = skipOptions(argv, index + 2, PM_VALUE_FLAGS);
  const subcommand = argv[index] ?? '';
  const isExec = PM_EXEC.has(subcommand);
  const isRun = PM_RUN.has(subcommand);
  const toolIndex = isExec || isRun ? skipOptions(argv, index + 1, PM_VALUE_FLAGS) : index;
  const tool = argv[toolIndex] ?? '';
  return { tool: NPM_ALIASES[tool] ?? tool, args: argv.slice(toolIndex + 1), via: name };
};

const resolveNodeScript = (argv) => {
  const scriptIndex = argv.findIndex((arg, i) => i > 0 && !arg.startsWith('-'));
  const script = argv[scriptIndex] ?? '';
  const isChemxScript = CHEMX_SCRIPT.test(script);
  if (isChemxScript) return { tool: 'chemx', args: argv.slice(scriptIndex + 1), via: 'node' };
  const binMatch = script.match(/node_modules\/(?:\.bin\/)?(?:[^/]+\/)*?([\w-]+?)(?:\.[cm]?js)?$/);
  const tool = binMatch ? binMatch[1] : 'node';
  return { tool, args: binMatch ? argv.slice(scriptIndex + 1) : argv.slice(1), via: 'node' };
};

export const resolveInvocation = (argv) => {
  const rest = stripWrappers(argv);
  const name = baseName(rest[0]);
  const isPackageManager = PACKAGE_MANAGERS.has(name) || LAUNCHERS.has(name);
  if (isPackageManager) return resolvePackageManager(name, rest);
  const isNode = name === 'node';
  if (isNode) return resolveNodeScript(rest);
  return { tool: name, args: rest.slice(1), via: null };
};

// Commands chemx itself runs, or its documented launchers, own every word after them.
export const isChemxInvocation = (invocation) => {
  const isPackageScriptAlias = PACKAGE_MANAGERS.has(invocation.via) && invocation.tool === 'q';
  return CHEMX_BINS.has(invocation.tool) || isPackageScriptAlias;
};
