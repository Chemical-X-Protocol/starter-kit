# chemx q: symbols and text

`chemx q <query>` answers from the symbol index. `chemx q -g <pattern>` searches text. One call is enough for both: a query with no symbol hit runs the text search itself.

## Symbols, then text

`chemx q <text>` looks the text up in the index (components, exported symbols, props, hooks, files). With zero hits it runs the fixed-string search in the same call and labels the section:

```
Chemical X Query: "gs-blue" (0 results in 108ms)
  index: scope . (2 files) under /work/app; synced 2 files, ...
no symbols; fixed-string matches: 1 match in 1 files
  searched 5 files in . under /work/app via rg; dot-directories searched; git-ignored paths skipped (--hidden includes them)
src/styles/a.scss:1:.x { color: var(--gs-blue); ... }
```

The fallback searches the whole project (not only the index scope), shows up to 20 matches (`-n` changes that) and is skipped with `--tier` (a tier has no text meaning). `--json` carries it as `literal` (the same object `q -g --json` prints). MCP `chemx_q` appends the same labelled section when neither a symbol nor an FTS row matched.

## Scoping to paths

Words after the query are files or directories, relative to where chemx runs. They scope the symbol answer and the text search alike:

```
chemx q useTheme src/hooks            # symbols under src/hooks
chemx q -g "useTheme" src/hooks docs  # text under both
```

A path that does not exist is an error that names it and shows how to quote a phrase (`chemx q -g "foo bar"`); nothing is searched, so a mistyped phrase is never answered from the wrong scope. `--dir=<path>` is the same scope for the symbol index, and `--glob <path>` is another name for `--dir` (a path, not a pattern: an unquoted `cli/*.js` is expanded by the shell into paths, a quoted one is refused with that hint). `--max <N>` is another name for `-n <N>`.

## What is searched

Every text file git lists: tracked files, untracked files git does not ignore, and submodules. That includes the dot-directories and dotfiles of a project (`.github/workflows`, `.claude/settings.json`, `.chemxrc`, `.gitignore`), so a CI pin or a hook setting is found without a flag. Left out: what `.gitignore` (and `.git/info/exclude`) ignores, `.git` itself, `node_modules`, the chemx index dir `.chemx`, and Claude's worktree copies under `.claude/worktrees`; binary files and files over 8 MB are counted in `skipped`.

`--hidden` adds the ignored paths to that (build output, `.env`, caches), the chemx index dir and the worktree copies; `.git` and `node_modules` are still never searched (a pnpm app lists 110,000 files in `node_modules` and `--hidden` took minutes with them). The scope line says which of the two ran (`git-ignored paths skipped` or `included`), and `skipped.hidden` in `--json` is `true` when they were left out. The text fallback of `q <text>` honours `--hidden` too. Outside a git repo there is no ignore file to follow, so a walk skips generated directories (`node_modules`, `dist`, `vendor`, `.next`, `.cache`, `.claude`, and the like) unless `--hidden`.

## Fixed string, regex

`-g` is a fixed-string search: `a|b`, `\|`, `.*` and `[a-z]` are plain characters. The header says `(fixed string)`, and when such a pattern finds nothing the answer says so and names `--regex` (`hint` in json, stderr in the pipe modes). `--regex` searches a regular expression instead:

```
chemx q -g "useA|useB" --regex
```

Regex mode is the RE2 subset: alternation, groups, classes, anchors, `\d \w \s \b`, counted repeats. Lookaround (`(?=` `(?!` `(?<=` `(?<!`) and backreferences (`\1`, `\k<name>`) are refused with the reason on both engines, so the answer never depends on whether `rg` is installed. Without ripgrep the JS engine backtracks, so it also refuses a quantified group that holds a quantifier (`(a+)+`); ripgrep runs those in linear time. Add `-i` to ignore case.

## Output modes

| Flag | Prints | Default cap |
| :--- | :--- | :--- |
| (none) | header, scope line, `path:line:text` rows | 20 matches, truncation stated |
| `--bare`, `-b` | the `path:line:text` rows only, with `-C/-B/-A` context | none |
| `-l`, `--files-with-matches` | each matching file once | none |
| `--lines` | `path:line` per match | none |
| `-o`, `--only-matching` | `path:line:matched` per match: the matched text, not the line | none |
| `--unique` (implies `-o`) | each distinct matched text once, sorted | none |

The pipe modes (everything but the first row) print records on stdout and notes on stderr (`no matches`, `showing N of M files`, the regex hint). `-n` caps the list, files and distinct values included. Listing every distinct design token takes one call:

```
chemx q -g "--gs-[a-z0-9-]+" --regex -o --unique
```

`-l` used to print `path:line`; that is `--lines` now. `--json` for the list modes carries `files` (`-l`) or `distinct` (`-o --unique`), and `-o` rows carry `parts` instead of `text`. MCP: `filesOnly`, `onlyMatching`, `unique`, `regex`, `paths`, `bare`.
