// Command schema entry for `chemx report`. Assembled in commands-schema.js.
export const REPORT_COMMANDS = [
  {
    name: 'report',
    aliases: [],
    group: 'agents',
    brief: 'Savings report for a run',
    usage: 'chemx report savings --run=<wf_id|run dir> [options]',
    summary: 'Routing savings (same tokens, different price) and tooling savings (chemx results vs the native counterfactual chemx recorded), each with its method and n.',
    description: 'Tooling figures cover only calls chemx logged after call logging began; the report states that moment and never extrapolates. Set CHEMX_CALL_LOG=0 to turn call logging off.',
    flags: [
      { flag: '--run=<id|dir>', desc: 'Workflow run id (wf_...) or transcript directory' },
      { flag: '--baseline=<model>', desc: 'Price the same tokens as opus (default), sonnet, haiku or fable' },
      { flag: '--json', desc: 'Output data as JSON' }
    ],
    examples: ['chemx report savings --run=wf_bf6ddafb-64a', 'chemx report savings --run=wf_bf6ddafb-64a --baseline=sonnet --json']
  }
];
