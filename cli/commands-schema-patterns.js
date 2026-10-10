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
      { flag: '--include-tests', desc: 'Also fingerprint spec files (--sync, --groups, --forge, --score --forge)' },
      { flag: '--tests', desc: 'Same as --include-tests' },
      { flag: '--idioms', desc: 'Keep idiom groups (--groups, --forge)' },
      { flag: '--sync', desc: 'Refresh the Forge fingerprint ledger only and print its counts as JSON' },
      { flag: '--groups', desc: 'Refresh the ledger, then print the Forge groups as JSON in the scorer shape' },
      { flag: '--input=<groups.json>', desc: 'With --score: score these groups instead of a detector' },
      { flag: '--dir=<d>', desc: 'With --score: the legacy detector scans this directory' },
      { flag: '--reason=<text>', desc: 'With `patterns reject`: why the group is suppressed' }
    ],
    examples: ['chemx patterns', 'chemx patterns src --min=3', 'chemx patterns --forge', 'chemx patterns --forge --limit=20 --json', 'chemx patterns --forge --explain=3f2a9c0d', 'chemx patterns reject 3f2a9c0d --reason="house shape" --as=@me']
  },
  {
    name: 'blueprint',
    aliases: [],
    group: 'verify',
    brief: 'Plan the extraction of one repeated-code group',
    usage: 'chemx blueprint <group-id|bp-id> [--json] | chemx blueprint --item=<A7> [--json] | chemx blueprint holes <target> | chemx blueprint fill <target> <hole>=<value> --as=@handle',
    summary: 'Build, show and fill the blueprint of a Forge group: kind, piece name and module, call sites, rejected members, drift, holes and the work tier.',
    description: 'Refreshes the fingerprint ledger, builds the blueprint of the group (an id from `chemx patterns --forge`, or a ground-truth item with --item), stores it by its content-derived bp_ id and prints it. The same group in the same state always prints the same bytes. `holes` lists the judgment holes with their defaults and constraints; `fill` validates a value (a name must be a free identifier, a wording at most 120 characters with no em dash, a decision one of its candidates) and records it for the heal. It plans only: nothing is edited.',
    flags: [
      { flag: '--json', desc: 'Print the canonical JSON (chemx.blueprint/1) instead of the summary' },
      { flag: '--item=<id>', desc: 'Name the group by a ground-truth item (the surfaced group touching most of its anchors)' },
      { flag: '--as=<@handle>', desc: 'With fill: who filled the hole' }
    ],
    examples: ['chemx blueprint 01c90f0e', 'chemx blueprint --item=A7 --json', 'chemx blueprint holes bp_aeabff52315c', 'chemx blueprint fill bp_aeabff52315c name=readJson --as=@me']
  },
  {
    name: 'heal',
    aliases: [],
    group: 'verify',
    brief: 'Apply a blueprint, verify, roll back on failure',
    usage: 'chemx heal <bp-id|group-id> [--dry-run] [--fill=<hole>=<value>] [--json] --as=@handle | chemx heal --item=<A7> ... | chemx heal --undo=<run-id> --as=@handle',
    summary: 'Extract the piece of a blueprint and replace its call sites with calls, then verify (parse, audit delta, typecheck, covering specs, post-condition) and roll back to byte-identical files on any failure.',
    description: 'Plans the heal in memory (members re-located by fp and body hash, so line drift is not staleness and a changed body refuses with BLUEPRINT_STALE), leases every path or none (CHEMX_FILE_LOCKED on any foreign lease, before any write), writes through applyEdits, then verifies: parse, no rule count rises in a touched file under the project config and atomic-strict, the piece in the checkJs-strict sandbox plus a scoped tsc delta where the project typechecks the files, the covering specs (reverse imports, depth 2) through chemx test, and the post-condition. A failure restores every file and records outcome rolled_back with the stage. Each attempt is a heal_runs row. --dry-run prints the diff and the in-memory audit and writes nothing. --undo restores an applied run while every file still has the bytes the heal left. Heal never commits. Today it handles extract-function and reuse blueprints whose piece has a body (library pieces).',
    flags: [
      { flag: '--dry-run', desc: 'Print the diff, the in-memory audit and post-condition, and the lease check; write and lease nothing' },
      { flag: '--item=<id>', desc: 'Name the group by a ground-truth item, as chemx blueprint --item does' },
      { flag: '--fill=<hole>=<value>', desc: 'Fill a hole before healing (validated like chemx blueprint fill); repeatable' },
      { flag: '--undo=<run-id>', desc: 'Restore the files of an applied, uncommitted heal run (also --undo <run-id>)' },
      { flag: '--spec-depth=<N>', desc: 'Reverse-import depth for covering specs (default 2)' },
      { flag: '--json', desc: 'Print the result as JSON' },
      { flag: '--as=<@handle>', desc: 'Who heals (leases are taken as this handle); required except for --dry-run' }
    ],
    examples: ['chemx heal --item=A7 --dry-run', 'chemx heal bp_aeabff52315c --as=@me', 'chemx heal --undo=hr_0a1b2c3d4e --as=@me']
  }
];
