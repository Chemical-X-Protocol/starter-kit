# Completeness critique of the chemx review

## 1. Gaps: modules nobody reviewed, now checked

Four groups under `cli/` had no findings in any of the eight areas: `audit/autofix.js` with `mutators.js`, `exploder.js`, `license.js`, and the installer templates. I checked the two most dangerous ones and both have critical defects.

### GAP-1 (critical, confirmed): autofix produces broken code and deletes Markdown fences

The review only noted that autofix is classified as a mutating action. Nobody looked at what it actually changes.

`cli/audit/autofix.js:29-110` works line by line with regexes and ignores context:
- **Comment openers:** it deletes the first line of a multi-line `/* … */` or `<!-- … -->` comment if that line matches the "preamble" regex, which leaves an orphaned `*/` or `-->`.
- **Markdown:** it deletes every line matching a ```` ``` ```` fence. `.md` is in `FIXABLE_EXTENSIONS` (line 15).
- **Em dashes:** it replaces them with hyphens inside string literals and template text.
- **Timers:** it rewrites `setTimeout(fn, 0)` to `queueMicrotask(fn)`. That rewrite returns `undefined`, so a later `clearTimeout(id)` silently stops working.

I reproduced this with `node /tmp/claude-1000/-home-xopher-www-x-Xophz-COMPASS/chemx-review/autofix-probe.mjs`, which calls the pure function `autofixContent`:
```
=== ts fixes=5
   Handles edge cases. */          <- opener "/* Here is the complete implementation…" deleted
const id = queueMicrotask(tick);
clearTimeout(id);
const label = 'Save - or cancel';  <- string literal changed
const prompt = `
foo()                              <- fences inside a template literal deleted
=== vue  -> "       header goes here -->"   (opening <!-- line deleted)
=== md   -> both ``` lines of a code block deleted
```

A dry run against the kit itself (`runAutofix(t,{dryRun:true})`):
- README.md: 20 fixes
- AGENTS.md: 17
- docs/: 31

Every sampled hit is a bare ```` ``` ```` line (`sed -n '45p;58p' README.md` prints ```` ``` ````).

Other ways in:
- `chemx fix` with no argument targets `src` (`mutators.js:250`).
- The MCP `autofix` handler falls back to `.` when there is no `src/` (`mcp/tools-patterns.js:64`), which pulls in the docs.
- Dry run reports at most 15 fixes (`autofix.js:173`), so a user can't review the full change set before applying it.

The host `src/` currently has 0 matches, so the damage is latent there. It is active for the kit and any repo that has docs.

### GAP-2 (critical, confirmed): `chemx explode` deletes the source file and writes a stub, reporting success

`exploder.js:15-90` keeps only four kinds of top-level node:
- exported interfaces and types
- the first exported `use*Controller`
- the first exported `const`
- `react` imports

Everything else is dropped: non-exported helpers, other imports, `export function`, and a second exported component. If nothing matches, a default `<div/>` stub is written. The original file is then removed and its backup deleted (`exploder.js:189-190`). The only "verification" is a Babel parse of the generated stub (line 183).

Reproduced in the scratch directory (`explode-probe/card.tsx`, which uses `export function Card` plus a `formatPrice` helper and a `clsx` import):
```
{"success":true,"capsuleName":"card",...}
card/card.tsx:  export const Card = ({ className = '' }: CardProps) => { return <div className="card" />; };
```
The original logic is gone and `card.tsx` is deleted. The generated controller always imports `react`, and a `.vue` input would get a React body written into a `.vue` file. Dry run (line 120) parses the file but never reports what will be dropped.

### GAP-3 (high, extends agent-ergonomics `guard-hook-denies-grep`): the guard hook blocks routine non-read commands

`.claude/hooks/chemx-guard.mjs:33` splits commands on `&& || ; \n` but not on a single `|`. Line 27 then denies any segment that contains `cat/head/tail` together with a source extension anywhere.

This session hit four false denials:
- `wc -l a.js … | sort | head`
- `grep -n … file.js | head` (a non-recursive grep)
- `cat > probe.mjs <<EOF`, which is a write, yet the hook suggested `chemx read`
- `node probe.mjs … | tail -8`

The sanctioned bypass is a comment the agent appends itself, so the hook adds friction without being enforceable. The tools it redirects to (`chemx read --start/--end`) also drop line numbers (see `reads-drop-line-positions`).

### GAP-4 (medium): CI gate and local tools run three different chemx versions

The generated GitHub workflow runs `npx --yes chemx audit --min-grade=…` with no version pin (`installer-templates.js:182`). The pre-commit hook falls back to `npx chemx` (line 117).

The same code is therefore judged by:
- the latest published version in CI
- the stale pinned `chemx@26.9.20-1257` in MCP
- the HEAD symlink in the CLI

Because the ratchet has no rule-set version, any new publish can turn CI red with no code change.

### GAP-5 (low/medium): interactive detection is inconsistent, and the licensing code was never reviewed

`license.js` reads `!isTTY` at line 120 and `isTTY === false` at lines 234-235. `scaffold.js:22-23`, `terminal.js:22-23,74` and `rules-predicates.js:138` also use `=== false`, which never fires on a pipe. The effect: `hasGum()` returns true under pipes or MCP, and `gumChoose` inherits stdin (`terminal.js:40`).

`generator.js:300` is safe only because it computes `isYes` from `!process.stdin.isTTY` separately.

`license.js` also sends a persistent `device_id` (`~/.chemical-x/device_id`) plus the license key to two domains, chemicalx.xophz.com and mycompassconsulting.com (lines 28 and 352). It calls `process.exit` from library code (lines 175, 366, 389). No doc discloses any of this.

### Still unexamined (not checked)
- `project-detector.js` (336 LOC), whose runner and framework detection is a likely root cause of `runner-detection-wrong-runner` and `vue-sfc-typecheck-false-green`
- `languages.js` and the polyglot readers
- `config/loader.js` merge semantics (only noted as "parsed but unused")
- `trend.js`
- the content of `navigator-share.js` publications: an audit report including the repo URL is posted to the public `Chemical-X-Protocol/.github` Discussions
- the `ui-client-cert.js` and `ui-dev-watcher.js` attack surface beyond the SQL finding

## 2. Cross-cutting root causes

1. **Regex and line-oriented code handling where an AST or SFC parser is needed.** This one cause covers autofix (GAP-1), explode (GAP-2), the patch `$` substitution, `--symbol` brace counting, read comment stripping, outline gaps, the Vue blind spots in audit and index, blast-radius substring seeding, the `mutators.js` interface regex (`mutators.js:78` silently no-ops on `type Props = {}` but still lists the file under `updatedFiles`), and the guard's pipe parsing. chemx already ships Babel and an SFC-capable index, but most mutators and readers bypass them.

2. **Success is reported by default when nothing proves it.** Examples: zero tests means "passed"; batch exits 0 after aborting; `build --command` is ignored; MCP `q` returns a stale index as "results"; wrappers swallow git errors; hazards reports "healthy" with no audit; explode returns `success:true` with a stub; mutators list files they didn't change; dry runs that write (MCP patch) or that show no diff. There is no "inconclusive" state anywhere in the result model.

3. **There is no single entry point for context: cwd, root, TTY and version.** Each module decides for itself:
   - **Project root:** each module picks its own (MCP `--dir apps/my-card-vault`, wrappers ignore `projectRoot`, specs depend on cwd, `:memory:` is treated as a path).
   - **Interactivity:** at least 6 different `isTTY` checks.
   - **Version:** pinned MCP, unpinned CI, symlinked CLI.

   Behind this sit 36k LOC of unchecked JS: `checkJs` reports 287 errors, including real `ReferenceError`s.

4. **The surface area is larger than the verification behind it.** About 22% of the code is swarm, UI and tesseract that is rarely used. Destructive commands (fix, explode, write, patch, add:*) have specs only for clean fixtures; none cover content preservation, docs, Vue, or MCP dry runs. Meanwhile, documentation and the guard hook push agents onto these paths and away from Claude Code's own Read, Edit and Grep, which have line numbers, diffs and checkpoints.

5. **Agents pay tokens without getting a better signal.** ANSI codes leak through pipes, JSON is double-encoded, payloads exceed the raw tool output, issue URLs run to 2KB, `tesseract` costs about 2.4k tokens per call, and calls take 1.5-6s to start. All of this works against chemx's main purpose of saving tokens.

## 3. Five highest-leverage improvements

1. **Add a tri-state result contract (`pass | fail | inconclusive`) enforced at one choke point**, the CLI/MCP result envelope. Report zero tests collected, a skipped batch step, an ignored flag, a stale or out-of-scope index, a missing audit, or a Vue project checked without vue-tsc as `inconclusive` with exit code ≠ 0. This removes the whole class of six or more critical silent false-green findings. Add a spec for each.

2. **Make every mutation preview-first, AST-backed and reversible.** Route write, patch, autofix, explode and add:* through one `applyEdits()` that:
   - parses before and after (Babel, plus `@vue/compiler-sfc` for `.vue`) and refuses if the result doesn't parse, or if any top-level declaration disappears unless it was named;
   - emits a unified diff on every dry run, uncapped or paginated;
   - writes atomically (temp file + rename) and keeps a backup;
   - honours dryRun the same way in CLI and MCP, and respects team locks.

   Remove `.md` from autofix and stop it from touching string literals and template text. Drop the `setTimeout` to `queueMicrotask` rewrite, or limit it to suggestion-only. This fixes 4 critical and about 6 high findings, including GAP-1 and GAP-2.

3. **Give chemx one context resolver and one output policy.**
   - A single `resolveContext({cwd, projectRoot, mcpRoots})` returns the root, index DB path, runner, framework and version. Every command and wrapper uses it, and every payload states which root and version produced it.
   - A single `isInteractive = Boolean(stdout.isTTY && stdin.isTTY) && !CI && !flags`, with plain output (no ANSI, no gum, no issue URLs) whenever it is false.
   - MCP children get `stdin:'ignore'` and a timeout.
   - The `.mcp.json` launcher, pre-commit hook and CI workflow all pin the same version. Version the rule set and the index schema, so an upgrade rebaselines instead of failing the ratchet and an old index is rebuilt instead of served.

4. **Make Vue a first-class target, or declare it unsupported.** The host is a Vue 3 monorepo, yet typecheck, audit, index, blast radius, outline, the generator and explode all treat `.vue` as TSX or ignore templates and the second `<script>` block. Parse SFCs once with `@vue/compiler-sfc` and give the result to every consumer: template component tags and aliases for blast radius, `defineProps` for metadata, and vue-tsc for typecheck. Until that exists, every Vue result should be marked `inconclusive`.

5. **Cut scope and stop competing with the host agent's own tools.**
   - Change the guard hook from deny to a hint, or remove it, and stop denying Grep, Read and Edit, since chemx's replacements are strictly weaker today.
   - Narrow the MCP tool to what has been proven: verify, test, typecheck, `q`, read-outline.
   - Freeze or split out swarm, UI (which also has the critical unauthenticated SQL file-write), tesseract, share and the licensing prompts.
   - Make the CLI type-checked with `checkJs` in CI and lazy-load parsers so wrappers start in under 200 ms.

   This shrinks the attack surface, the token cost and the untested code at the same time.

## Strengths to keep (confirmed this pass)
- **Clear guard hook design:** `chemx-guard.mjs` has a readable rule table and a documented escape hatch.
- **Some real transactions:** the explode rollback machinery (`exploder.js:205-215`) is real, even though the success path loses data.
- **Clean autofix design:** the `runAutofix` dry-run gate is a single `if (!dryRun)` in `autofix.js:166`, and `autofixContent` is a pure function. Both make the fixes in improvement 2 cheap to build and test.

Scratch files (no repo files modified): `/tmp/claude-1000/-home-xopher-www-x-Xophz-COMPASS/chemx-review/autofix-probe.mjs`, `/tmp/claude-1000/-home-xopher-www-x-Xophz-COMPASS/chemx-review/autofix-dry.mjs`, `/tmp/claude-1000/-home-xopher-www-x-Xophz-COMPASS/chemx-review/explode-probe/`