### Changelog fragments: one file per change, `chemx changelog` folds them (epic #6745, K18 #6767)

Reference: [changelog.d/README.md](changelog.d/README.md), `chemx changelog --help`. Every wave 1 pull request (K1, K2, K4, K5) edited the top of this file and conflicted on rebase; each agent spent a rebase or two resolving it.

- A change now adds `docs/changelog.d/<ticket-or-slug>.md` instead of editing this file. The first line is the section heading (`### Fixed`, `### Added`, or a title with the ticket id), then the text; one section per fragment.
- `chemx changelog` folds every fragment into `## Unreleased`, in file name order, above the sections already there, and deletes the fragment files. Fragments with the same heading become one section; a heading Unreleased already has gets the text at the end of that section; every other line of this file is untouched. `--dry-run` says what would fold; `--json` prints `{ fragments, problems, sections, folded }`.
- `chemx changelog --check` validates the fragments and that they would fold, and exits 1 on a malformed one (no `###` first line, no text, a second heading, a name that is not `<ticket-or-slug>.md`, a stray non-`.md` file) or on a changelog with no `## Unreleased` section. A fold that finds a problem writes nothing and deletes nothing.
- `docs/changelog.d/README.md` is not a fragment. AGENTS.md (reflex table) and the epic protocol say to write a fragment and never edit this file directly.
- Not done: nothing folds fragments automatically; the orchestrator folds after a wave. The team help text and the `team` schema entries, the other hot spots, are split in a follow-up (#6767, part 2).
