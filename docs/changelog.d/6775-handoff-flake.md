### Fixed (K22 #6775)

- `team-task-handoff.spec.js` no longer flakes on a fast runner (#6775). The `--with-locks` test made its expired lease with `ttlMs: 1`, which is still live when the clock has not ticked a millisecond by the time the handoff reads it, so `cli/old.js` moved to the new holder and the test failed (twice in CI on unrelated PRs). The test now backdates `expires_at` straight on the row, the way `lease-lapse.spec.js` does. Proved with a frozen clock (`Date.now` pinned): the old spec fails every time, the new one passes every time.
- `team-lease-safety.spec.js` dropped a redundant `ttlMs: 1` on a lease it backdates on the next line (#6775). Specs only; no runtime change.
