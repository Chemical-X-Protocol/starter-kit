// Command schema entry for `chemx patterns`. Assembled in commands-schema.js.
// Each long flag has its own entry because the router flag guard reads only the `flag` field.
export const PATTERNS_COMMANDS = [
  {
    name: 'patterns',
    aliases: [],
    group: 'verify',
    brief: 'Find repeated code worth extracting',
    usage: 'chemx patterns [dir] [--type=<T>] [--min=<N>] [--full] [--score=<labels.json>] | chemx patterns --forge [dir] [--rejected] [--explain=<id>] [--limit=<N>] [--json] | chemx patterns reject <id> --reason="..." --as=@handle',
    summary: 'List repeated code patterns found by the audit (same handler as the MCP patterns action), or the Forge groups behind --forge.',
    description: 'Prints compact JSON candidates with sample occurrences. Interim alias until the Forge surface lands. --forge refreshes the fingerprint ledger, groups it (exact buckets, windows, same-name near misses, siblings, templates), anti-unifies every group, judges it by R1-R8, ranks it, stores the run in index.db and prints one line per ranked group plus a rejected-summary line by reason code. `patterns reject` suppresses a stored group and posts the decision to the team feed. A long flag not listed here is refused and nothing runs.',
    flags: [
      { flag: '--type=<T>', desc: 'Only this pattern type (default: ALL)' },
      { flag: '--min=<N>', desc: 'Minimum file count (default: 2)' },
      { flag: '--full', desc: 'Include every occurrence instead of samples' },
      { flag: '--score=<labels.json>', desc: 'Score the detector against the content-anchored ground truth (cli/patterns/fixtures/gt/labels.json); add --json, --dir=<d>, --input=<groups.json>' },
      { flag: '--forge', desc: 'Forge groups, one line per ranked group plus the rejected summary; `patterns reject <id> --reason=<text> --as=@h` suppresses one' },
      { flag: '--rejected', desc: 'With --forge: list the rejected groups with their codes' },
      { flag: '--explain=<id>', desc: 'With --forge: holes, members and codes of one group' },
      { flag: '--limit=<N>', desc: 'With --forge: print at most N ranked groups (also applies to --json)' },
      { flag: '--json', desc: 'Print JSON instead of lines (with --forge or --score)' },
      { flag: '--path=<P>', desc: 'With --forge: only groups with a member under this path' },
      { flag: '--kind=<K>', desc: 'With --forge: only groups of this kind' },
      { flag: '--include-tests', desc: 'Also fingerprint spec files (--sync, --groups, --forge)' },
      { flag: '--idioms', desc: 'Keep idiom groups (--groups, --forge)' }
    ],
    examples: ['chemx patterns', 'chemx patterns src --min=3', 'chemx patterns --forge', 'chemx patterns --forge --limit=20 --json', 'chemx patterns --forge --explain=3f2a9c0d', 'chemx patterns reject 3f2a9c0d --reason="house shape" --as=@me']
  }
];
