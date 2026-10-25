// Command schema entries for the setup group: `init`, `create`, `pillars`, `ui` and `tesseract`. Assembled in commands-schema.js.
export const SETUP_COMMANDS = [
  {
    name: 'init',
    aliases: [],
    group: 'setup',
    brief: 'Unpack blueprints into an existing codebase',
    usage: 'chemx init [directory] [options]',
    summary: 'Unpack blueprints and molecular architecture drop-in files into an existing codebase.',
    description: 'Installs blueprints, domain hooks and foundation capsules (default: src/chemical-x).',
    flags: [
      { flag: '--license=<key>', desc: 'Commercial license key for enterprise starter kit assets' },
      { flag: '--yes, -y', desc: 'Skip interactive prompts' },
      { flag: '--headless', desc: 'Headless mode for CI and agents' },
      { flag: '--ci', desc: 'Same as --headless' },
      { flag: '--non-interactive', desc: 'Same as --headless' },
      { flag: '--no-interactive', desc: 'Same as --headless' },
      { flag: '--framework=<id>', desc: 'Framework flavor: react, vue, svelte' },
      { flag: '--install', desc: 'Install dependencies after unpacking' }
    ],
    examples: ['chemx init', 'chemx init src/chemical-x']
  },
  {
    name: 'create',
    aliases: ['scaffold'],
    group: 'setup',
    brief: 'Scaffold a complete new app',
    usage: 'npm create chemx [directory] [options]',
    summary: 'Scaffold a complete new Chemical X application.',
    description: 'Also available as `chemx create [directory]`.',
    flags: [
      { flag: '--framework=<id>', desc: 'Framework flavor: react (default), vue, svelte' },
      { flag: '--yes, -y', desc: 'Skip interactive prompts' },
      { flag: '--install', desc: 'Install dependencies after scaffolding' },
      { flag: '--headless', desc: 'Headless mode for CI and agents' },
      { flag: '--ci', desc: 'Same as --headless' },
      { flag: '--non-interactive', desc: 'Same as --headless' },
      { flag: '--no-interactive', desc: 'Same as --headless' },
      { flag: '--preset=<name>', desc: 'Apply a named preset' }
    ],
    examples: ['npm create chemx my-app --framework=react', 'chemx create my-app --framework=svelte --install']
  },
  {
    name: 'pillars',
    aliases: ['config:pillars', 'rules'],
    group: 'setup',
    brief: 'Configure architecture pillars and shims',
    usage: 'chemx pillars [options]',
    summary: 'Configure architectural pillars and agent steering shims.',
    description: 'Writes host shims (CLAUDE.md, .cursorrules, llms.txt) that point at AGENTS.md. Seeds AGENTS.md if absent; otherwise leaves it alone. With --protocol or --protocol-only it also writes coordination-protocol rules for hosts without Claude Code hooks: GEMINI.md, .agent/rules/chemx-protocol.md, and a marked block in AGENTS.md and .cursorrules. Those hosts are told the steps; nothing blocks them if they ignore them.',
    flags: [
      { flag: '--yes, -y', desc: 'Skip prompts' },
      { flag: '--force', desc: 'Overwrite hand-authored files (a backup is written first)' },
      { flag: '--preset=<recommended|strict|minimal|none>', desc: 'Apply a predefined pillar preset' },
      { flag: '--write', desc: 'Write the files (default is a dry run)' },
      { flag: '--protocol', desc: 'Also write the coordination protocol files, between chemx:protocol markers in AGENTS.md and .cursorrules' },
      { flag: '--protocol-only', desc: 'Write only the protocol files; config, CLAUDE.md and llms.txt are not touched' },
      { flag: '--json', desc: 'Output configuration as JSON' }
    ],
    examples: ['chemx pillars', 'chemx pillars --preset=recommended --write', 'chemx pillars --protocol-only --write']
  },
  {
    name: 'ui',
    aliases: ['dashboard', 'preview'],
    group: 'setup',
    brief: 'Start the web dashboard',
    usage: 'chemx ui [options]',
    summary: 'Launch the Chemical X web dashboard.',
    description: 'Kanban task boards, agent rails, SQLite studio and AST tree exploration.',
    flags: [
      { flag: '--port=<N>', desc: 'Server port (default: 4173)' },
      { flag: '--dev', desc: 'Run the dashboard in dev mode (also -d or CHEMX_UI_DEV=1)' },
      { flag: '--allow-host=<names>', desc: 'Extra Host header names to accept, comma-separated (repeatable)' },
      { flag: '--host=<addr>', desc: 'Bind address (default: 127.0.0.1). A non-loopback host exposes the UI beyond this machine and prints a warning.' }
    ],
    examples: ['chemx ui', 'chemx ui --port=3000']
  },
  {
    name: 'tesseract',
    aliases: ['cube', 'matrix'],
    group: 'setup',
    brief: 'Print the agent onboarding briefing',
    usage: 'chemx tesseract [options]',
    summary: 'Agent onboarding HUD: directives, topology and swarm telemetry.',
    description: 'Prints the operational directives and current project state.',
    flags: [{ flag: '--json', desc: 'Output the payload as JSON' }],
    examples: ['chemx tesseract', 'chemx tesseract --json']
  }
];
