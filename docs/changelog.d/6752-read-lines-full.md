### Added (K7 #6752)

- `chemx read` accepts `--lines a-b` and `--lines=a-b` as aliases of `:N-M` for line ranges, matching the range syntax agents commonly try (#6752).
- `chemx read` accepts `--full`, returning the whole file without truncation or the 100-line read window cap, including a token estimate (#6752).
- `chemx read --bare` on long files never substitutes an AST outline; when truncated at the read window, it prints the text slice followed by a one-line notice stating how many lines remain and the next range (#6752).
- `chemx read` flag errors name the three accepted range forms: `<file>:N-M`, `--lines a-b`, and `--start=N --end=M` (#6752).
- Schema and help entries for `read` list `--lines` and `--full` with usage examples (#6752).
