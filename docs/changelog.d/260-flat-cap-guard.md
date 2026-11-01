### Fixed

- The landing funnel's generation layer no longer states a flat `<100 LOC` cap. It now says each generated file stays under 100 LOC, so it passes even atomic-strict, and `cli/audit/line-budgets.spec.js` scans that file too (#260).
- The docs-drift guard (`cli/docs-drift.spec.js`) catches every wording of a fixed 100-line budget that guidance used to carry, such as `exceeding 100`, `approaching 100 lines` and `100-line cap`, and it has a self-test for those wordings. Lines that name atomic-strict or the read window still pass (#260).
- New regression specs: token burn against each file's own line budget, the 250/251-line molecule compliance boundary, the patcher's pragmatic and capped limits, fresh React, Vue and Svelte scaffolds passing their own audit (`cli/scaffold-audit.slow.spec.js`), `AI_SLOP_LAZY_ANY` on an annotated catch, annotations in a Vue SFC, and the hook template's printf lines matching `scripts/pre-commit.sh` (#260).
