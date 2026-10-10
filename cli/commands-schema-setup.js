// Command schema entries for `ui` and `tesseract` (setup group). Assembled in commands-schema.js.
export const SETUP_COMMANDS = [
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
