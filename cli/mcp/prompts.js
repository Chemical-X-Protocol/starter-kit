export const MCP_PROMPTS = [
  {
    name: 'chemx_remediate_hotspot',
    description: 'Generate surgical instructions to decompose a monolithic hotspot file into crystalline capsules (< 100 lines) and a declarative Table-of-Contents view.',
    arguments: [
      {
        name: 'filePath',
        description: 'Path of the monolithic file to refactor.',
        required: true
      },
      {
        name: 'targetFramework',
        description: 'Target framework (react, vue, svelte). Defaults to react.',
        required: false
      }
    ]
  },
  {
    name: 'chemx_harmonize_patterns',
    description: 'Execute the Directive 1.F Pre-Split Pattern Discovery workflow to identify and extract shared capsules before slicing consumer monoliths.',
    arguments: [
      {
        name: 'dir',
        description: 'Directory to audit for cross-file structural clones (defaults to src).',
        required: false
      }
    ]
  }
];

export const getMcpPrompt = async (name, args = {}) => {
  switch (name) {
    case 'chemx_remediate_hotspot': {
      const filePath = args.filePath;
      if (!filePath) {
        throw new Error('Prompt "chemx_remediate_hotspot" requires "filePath" argument.');
      }
      const framework = args.targetFramework || 'React/Vue';

      const userText = [
        `Act as a Principal Systems Architect. Surgically refactor the monolithic file \`${filePath}\` according to Chemical X Molecular Architecture Standards:`,
        '',
        '### EXECUTION DIRECTIVES:',
        '1. Pre-Split Pattern Discovery: Survey cross-file patterns before slicing; extract canonical shared capsules first.',
        '2. Molecular Capsule Limit: Maximum 100 lines per molecule capsule file.',
        '3. Table-of-Contents Views: Top-level page views must be 10-20 line declarative templates assembling components via named slots.',
        '4. Two-Stage Atomic Booleans: Break complex multi-clause conditionals into atomic single-concept booleans.',
        '5. Composable Return Contracts: Limit hook/composable returns to 3 to 5 properties (State + Status + Actions).',
        '6. Co-located Types: Co-locate granular types/*.d.ts inside each capsule (< 100 lines). Avoid type monoliths.',
        '7. Zero synthetic or mock data: Return live data or explicit empty states.',
        `8. Framework: Calibrate bindings for ${framework}.`,
        '',
        `Target file: \`${filePath}\`. Please produce a phased decomposition plan followed by modular capsule implementations.`
      ].join('\n');

      return {
        description: `Refactoring instructions for ${filePath}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: userText
            }
          }
        ]
      };
    }

    case 'chemx_harmonize_patterns': {
      const dir = args.dir || 'src';

      const userText = [
        `Act as a Principal Systems Architect. Execute Chemical X Directive 1.F Pre-Split Pattern Discovery across \`${dir}\`:`,
        '',
        '### DISCOVERY CHECKLIST:',
        '1. Run `chemx_query_patterns` to identify recurring state machines (STATE_UNION), JSX layouts (UI_STRUCTURE), and boolean predicates (PREDICATE_LOGIC).',
        '2. Map shared candidates to existing design tokens, foundational atoms (a-*), and central utilities.',
        '3. Extract canonical shared capsules first before modifying consumer files.',
        '4. Refactor consumer files to bind directly to the canonical capsules, preventing bespoke pattern proliferation.',
        '',
        'Please inspect detected patterns and output a prioritized extraction schedule.'
      ].join('\n');

      return {
        description: `Pre-Split Pattern Discovery workflow for ${dir}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: userText
            }
          }
        ]
      };
    }

    default:
      throw new Error(`Prompt not found: ${name}`);
  }
};
