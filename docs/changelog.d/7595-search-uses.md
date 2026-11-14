### Added: `q --uses` from the index, pluggable literal backends (task #7595)

- `chemx q <name> --uses` prints every indexed use of a name as `path:line:text`, from a new `occurrences` table filled in the same Babel pass as the symbols (#7595). Property keys, member properties and comment or string text are not uses. Byte size ties `grep -rnw` on the sampled lookups; see `benchmarks/search-vs-grep.mjs`.
- The index version is now 3, so the first query after upgrading rebuilds the index once (#7595).
- Literal search is a backend registry: `registerLiteralBackend(name, { search, isAvailable, isBacktracking })`, selected by `CHEMX_LITERAL_ENGINE` or the `engine` option. `rg` and `js` are built in (#7595).
- Not changed: `refs` (import statements), `--blast-radius`, `--trace` and `--backtrace`. Known gap: each query still pays the CLI's module-load cost (about 1.9 s for the search entry point), most of it the audit engine that `check-report.js` loads eagerly (#7595).
