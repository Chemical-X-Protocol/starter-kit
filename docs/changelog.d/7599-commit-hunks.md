### `chemx commit --hunks`: commit only your hunks of a shared file (#7599)

Reference: [commit.md](../commit.md#committing-only-some-hunks-of-a-file). Reported from a session that could not commit its half of five files other sessions were also editing: `chemx commit` stages whole files, so it had to hand-build index blobs and run plain `git commit`.

- `--hunks=<file>:<n,a-b>` (repeatable) commits only those hunks of the file, numbered as `git diff -U0 HEAD -- <file>` lists them. The rest stays in the working tree.
- Built on a private index (`GIT_INDEX_FILE`) that starts from HEAD: nothing another handle staged rides along, the pre-commit hook runs against it, and the real index entries of the listed files are put level with the new HEAD afterwards.
- A bad spec, a file with no changes against HEAD and a hunk number that is not there each refuse before anything is staged.
- Code: `cli/commit/commit-hunks.js`; spec: `cli/commit/commit-hunks.spec.js`.
