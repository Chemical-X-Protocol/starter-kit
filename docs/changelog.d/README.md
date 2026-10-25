# Changelog fragments

Write one file per change here, `docs/changelog.d/<ticket-or-slug>.md` (for example `6767.md` or `6767-changelog-fragments.md`), and never edit `docs/CHANGELOG.md` by hand. Two tickets that each add a line to the same file conflict on every rebase; two files never do.

## Format

- The first line is the section heading: `### Fixed`, `### Added`, `### Changed`, or a title that names the change and the ticket, the way the existing entries do (`### Doctor: kit drift, CI pin (epic #6745, K10 #6755)`).
- Then the text: a short paragraph of the problem if it helps, and bullets. Cite the ticket id (`#NNNN`) so `chemx team task show <id>` finds the task.
- One section per fragment: no other `#`, `##` or `###` heading (use `####` or bold for a subhead). Keep it to one change; write a second file for a second change.
- Lines inside a fenced code block are never read as headings.

```md
### Fixed (K18 #6767)

- `chemx foo` no longer drops the last line (#6767). Not changed: `chemx bar`.
```

## Folding

- `chemx changelog --check` validates every fragment here and that they would fold, and changes nothing; it exits 1 on a problem.
- `chemx changelog --dry-run` says what would be folded.
- `chemx changelog` folds every fragment into `docs/CHANGELOG.md` under `## Unreleased`, in file name order, above the sections already there, and deletes the fragment files. Fragments with the same heading become one section, and a heading Unreleased already has gets the text at the end of that section. Every other line of the changelog stays as it was.
- A malformed fragment or a changelog with no `## Unreleased` section refuses the whole fold: nothing is written and nothing is deleted.
- Anyone may fold, in a commit of its own that touches only `docs/CHANGELOG.md` and the fragments it removes. The orchestrator does it after a wave, and before a release.

This `README.md` is not a fragment, and neither is `.gitkeep`. Any other file here that is not a `.md` fragment is reported by `--check`.
