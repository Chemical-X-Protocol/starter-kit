// Command schema entries for the search group. Assembled in commands-schema.js.
export const SEARCH_COMMANDS = [
  {
    name: 'search',
    aliases: ['q', 'query', 'find'],
    group: 'search',
    brief: 'Search symbols, components or text',
    usage: 'chemx q <query|symbol|file> [options]',
    summary: 'Architecture-aware AST codebase query engine powered by SQLite (.chemx/index.db).',
    description: 'Indexes component tiers, exported symbols, props and hooks. Subcommands: refs <symbol>, deps <symbol|file>, context <target>. AST answers cover the printed index scope only (--dir to change it); exit 3 / status inconclusive means a stale or out-of-scope index, or no audit data. A query with no symbol hit runs the fixed-string search in the same call under "no symbols; fixed-string matches:". Paths after the query scope the answer (q useTheme src/hooks).',
    flags: [
      { flag: '--json', desc: 'Minified JSON format for LLM agents' },
      { flag: '--columnar', desc: 'Token-compact columnar format (cols/rows) for agent pipelines' },
      { flag: '-i, --inspect', desc: 'Inspect props and hooks without full source' },
      { flag: '--tier=<tier>', desc: 'Filter by tier: atom, molecule, organism, hook, view' },
      { flag: '--blast-radius, --blast, --impact', desc: 'Map direct consumers, transitive dependents and impacted tiers' },
      { flag: '--trace', desc: 'Forward call trace: downstream functions invoked by target' },
      { flag: '--backtrace', desc: 'Reverse backtrace: upstream callers leading to target' },
      { flag: '--max-depth=<N>', desc: 'Max depth for blast radius / trace traversal (default: 5)' },
      { flag: '--semantic', desc: 'Feature-hash name similarity (lexical fuzz, not a learned embedding)' },
      { flag: '--hybrid', desc: 'BM25 keyword + feature-hash similarity, fused by RRF' },
      { flag: '--hazards', desc: 'Query architectural rule violations (with --rule=<id>, --critical)' },
      { flag: '--pack', desc: 'Assemble a token-packed context bundle for a target symbol or file' },
      { flag: '-g, --literal', desc: 'Repo-wide fixed-string search (submodules, docs, tracked dot-directories such as .github and .claude; .gitignore honoured), full path:line:text; "a|b" is literal text, add --regex for alternation; -- <pattern>' },
      { flag: '--hidden', desc: 'With -g (and the text fallback of q <text>): also search what git ignores, the chemx index dir and .claude/worktrees; .git and node_modules are never searched' },
      { flag: '--regex', desc: 'With -g: the pattern is a regular expression in the RE2 subset (alternation, classes, anchors, counted repeats; no lookaround or backreferences, same answer with or without ripgrep)' },
      { flag: '-l, --files-with-matches', desc: 'With -g: print each matching file once, nothing else (like rg -l)' },
      { flag: '--lines', desc: 'With -g: path:line records, no text' },
      { flag: '-o, --only-matching', desc: 'With -g: print only the matched text, one path:line:text record per match (--regex captures a token such as --gs-[a-z-]+)' },
      { flag: '--unique', desc: 'With -g -o: print each distinct matched text once, sorted (implies -o); -n caps the list' },
      { flag: '-g <pattern> <path>...', desc: 'Scope a literal search to files or directories (relative to where chemx runs); a missing path is an error, and with no path the whole project is searched. Quote a multi-word phrase: -g "foo bar". A plain query takes the same paths: q <symbol> <path>...' },
      { flag: '-n, --limit <N>', desc: 'Max results (q default 50, -g default 20, none for --bare -l --lines -o --unique); truncation is always stated' },
      { flag: '--max <N>', desc: 'Same as -n, --limit' },
      { flag: '--dir=<path>', desc: 'Scope to search (default: the project default, src/ or .)' },
      { flag: '--glob <path>', desc: 'Same as --dir: a file or directory, not a pattern (the shell expands cli/*.js into paths for you)' },
      { flag: '--failing, --clean', desc: 'Filter capsules by architectural health status' },
      { flag: '--reindex', desc: 'Force re-index before running query' },
      { flag: '--bare, -b', desc: 'Raw match lines without headers, banners, ANSI, or tips' },
      { flag: '-C, --context=<N>', desc: 'Lines of context before and after each match' },
      { flag: '-B, --before-context=<N>', desc: 'Lines of leading context before each match' },
      { flag: '-A, --after-context=<N>', desc: 'Lines of trailing context after each match' },
      { flag: '--raw-json', desc: 'With --json: row objects instead of columnar cols/rows' },
      { flag: '--no-columnar', desc: 'Same as --raw-json' },
      { flag: '--include-internal', desc: 'Include internal symbols in the results' },
      { flag: '--rule=<id>', desc: 'Rule id for --hazards' },
      { flag: '--critical', desc: 'Only critical hazards (with --hazards)' },
      { flag: '--progression, --degraded, --crystalline', desc: 'Accepted by the q argument parser (cli/search-args.js); effect set by the query mode' },
      { flag: '--full, --ignore-case, --fixed-strings', desc: 'Accepted by the q argument parser (cli/search-args.js); -F is --fixed-strings' }
    ],
    examples: [
      'chemx q "badge"',
      'chemx q -g "useTheme" -l',
      'chemx q -g "--gs-[a-z0-9-]+" --regex -o --unique',
      'chemx q useTheme src/hooks',
      'chemx q a-button --blast-radius --json',
      'chemx q handleAction --backtrace',
      'chemx q "card" --tier=molecule'
    ]
  },
  {
    name: 'read',
    aliases: ['view', 'r'],
    group: 'search',
    brief: 'Read a file by outline, symbol or lines',
    usage: 'chemx read <file>|<rev>:<file>[:N-M] [options]',
    summary: 'Token-minified file reader with AST outline and logic extraction.',
    description: 'Extracts structural outlines, logic skeletons, line ranges, or targeted symbol declarations, from the working tree or (rev:file) at a git revision. A file over the 100-line window reads as an outline; one with nothing to outline (yaml, json, txt, shell) reads as its first 100 lines of text with the next range named.',
    flags: [
      { flag: '--outline, -o', desc: 'Signatures only' },
      { flag: '--logic, -l', desc: 'AST logic skeleton: control flow, guards and mutations' },
      { flag: '--template, -t', desc: 'Extract template markup only (Vue/Svelte/JSX)' },
      { flag: '--enrich', desc: 'Append a compacted logic skeleton after the outline' },
      { flag: '--trace=<name>', desc: 'Append forward call trace card inline (requires --enrich)' },
      { flag: '--backtrace=<name>', desc: 'Append reverse caller chain card inline (requires --enrich)' },
      { flag: '--symbol=<name>, -s', desc: 'Target a specific symbol definition' },
      { flag: '--connections', desc: 'Include caller graph and dependent references alongside symbol' },
      { flag: '--strip-comments', desc: 'Remove all code comments' },
      { flag: '--compact', desc: 'Remove blank lines and indentation' },
      { flag: '--start=<N>', desc: 'Starting line number (1-indexed)' },
      { flag: '--end=<N>', desc: 'Ending line number (1-indexed)' },
      { flag: '--bare, -b', desc: 'Raw content without headers or line numbers' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: [
      'chemx read src/store.ts --outline',
      'chemx read HEAD~1:src/store.ts --symbol=save',
      'chemx read src/controller.ts --logic',
      'chemx read api.ts --symbol=login',
      'chemx read src/router.ts --start=120 --end=160'
    ]
  },
  {
    name: 'trace',
    aliases: [],
    group: 'search',
    brief: 'Show what a symbol calls',
    usage: 'chemx trace <symbol> [options]',
    summary: 'Forward call trace: inspects downstream function invocations.',
    description: 'Maps the functions, services and external APIs called by the target symbol.',
    flags: [
      { flag: '--max-depth=<N>', desc: 'Max depth for call trace traversal (default: 3)' },
      { flag: '--json', desc: 'Output call tree as minified JSON' }
    ],
    examples: ['chemx trace useCartController', 'chemx trace handleCheckout --json']
  },
  {
    name: 'backtrace',
    aliases: [],
    group: 'search',
    brief: 'Show what calls a symbol',
    usage: 'chemx backtrace <symbol> [options]',
    summary: 'Reverse call backtrace: maps upstream caller chains leading to target.',
    description: 'Traces how components, views and handlers reach the target symbol.',
    flags: [
      { flag: '--max-depth=<N>', desc: 'Max depth for backtrace traversal (default: 5)' },
      { flag: '--json', desc: 'Output causal path as minified JSON' }
    ],
    examples: ['chemx backtrace handleCheckout', 'chemx backtrace postOrder --json']
  },
  {
    name: 'check',
    aliases: [],
    group: 'search',
    brief: 'Check one file against the rules',
    usage: 'chemx check <file> [options]',
    summary: 'Verify a single file or capsule against the architectural rules.',
    description: 'Runs the AST rules on one file and reports its hazards.',
    flags: [
      { flag: '--profile=<name>', desc: 'Audit profile to apply (e.g. atomic-strict)' },
      { flag: '--fast', desc: 'Skip the slower cross-file checks (PHP files report this when used)' },
      { flag: '--json', desc: 'Output hazards as JSON' },
      { flag: '--compact', desc: 'With --json: [rule,line,severity] rows and one rules map' }
    ],
    examples: ['chemx check src/components/m-card/m-card.vue', 'chemx check <file> --profile=atomic-strict']
  },
];
