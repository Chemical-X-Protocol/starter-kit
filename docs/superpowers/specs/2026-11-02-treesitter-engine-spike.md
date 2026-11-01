# Tree-sitter engine spike (P0-8): grammar builds, web-tree-sitter 0.27.1 API, bridge measurements

Date: 2026-11-01. Task: #6839 (P0-8), epic #6787. Spec: `docs/superpowers/specs/2026-11-01-language-adapters-design.md` (sections 4.5, 4.6, 4.8, 7, 10.1, 10.13). Authority: the owner decisions in spec section 12 (digest-pinned images, tag-pinned grammar repos).

This note records what was run and measured. Prototype code, sources, toolchains and built wasm live in the session scratch directory `ts-spike/` (absolute path in section 7); none of it is committed and nothing was installed into the kit's `package.json`.

**Decision: plan A (synchronous worker bridge) holds.** The bridge round trip p50 is 0.016 ms against a 0.5 ms criterion, and the bridge nested under the kit's real MCP offload `runWorker` was stable through repeated runs, abort and timeout. Plan B and task P3-9 are not needed. Section 6 lists the spec corrections the spike found; the largest is that tree-sitter-cli 0.27.1 never uses Docker or emscripten.

Machine: Linux 6.8 x86_64, 12 cores, 62 GB RAM, Node v22.23.2, Docker 29.9.2, no host `emcc`. Other agents were running builds and tests during the measurements, so wall times carry load noise; medians over repeats are reported.

## 1. Grammar builds (python, go, sql, perl)

### 1.1 How tree-sitter-cli 0.27.1 builds wasm

- **It does not drive a container.** `tree-sitter build --help` in 0.27.1 has no `--docker` flag, and the binary contains no `docker`, `podman` or `emsdk` strings. `build --wasm` compiles with **wasi-sdk clang** (`--target=wasm32-wasip1 -fPIC -shared -Os -nostdlib -fno-exceptions -fvisibility=hidden -Wl,--no-entry -Wl,--allow-undefined -Wl,--export=tree_sitter_<name>`), then runs **binaryen `wasm-opt -Os`** on the result (seen with `-v`).
- **Toolchain download.** When nothing is configured the CLI downloads and extracts the toolchain into `$HOME/.cache/tree-sitter/{wasi-sdk,binaryen}`:
  - `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz` (183 MB)
  - `https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-x86_64-linux.tar.gz` (111 MB)
  The output showed no checksum step, so the build script must not let the CLI download anything.
- **Pinned override.** `TREE_SITTER_WASI_SDK_PATH` and `TREE_SITTER_BINARYEN_PATH` point the CLI at pre-fetched toolchains. With both set the full build ran under `docker run --network none`, which proves no download happened. Pre-fetched assets matched the GitHub release digests:

| Artifact | sha256 |
| :--- | :--- |
| `tree-sitter-linux-x64.gz` (CLI 0.27.1 release asset) | `d01042f94ba3d6827ddc9788e235f75d8366431be42bdf90ade534d960c98b7d` |
| `wasi-sdk-34.0-x86_64-linux.tar.gz` | `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4` |
| `binaryen-version_132-x86_64-linux.tar.gz` | `195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572` |

- **Generate.** `tree-sitter generate` evaluates `grammar.js` with `node` by default (`--js-runtime`, env `TREE_SITTER_JS_RUNTIME`). `--js-runtime native` uses the embedded QuickJS. It worked for perl (output byte-identical to the node run) and python. It failed for sql: `QuickJS error: str is not defined at make_keyword (grammar.js:3689)`, because the grammar assigns an implicit global that strict mode rejects. SQL therefore needs node.
- **glibc.** The CLI binary wants glibc 2.39. On `node:22-bookworm-slim` (glibc 2.36) every call printed `weak version 'GLIBC_2.39' not found` but still worked. `node:22-trixie-slim` is clean.

### 1.2 The container is ours, and it can be digest-pinned

Docker only isolates third-party code at build time (`grammar.js` under node, plus the compiler run). The spike used:

```
docker run --rm --network none --user $(id -u):$(id -g) \
  -v cli:/cli:ro -v toolchain:/toolchain:ro -v work:/work -v out:/out -v scripts:/scripts:ro \
  node@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f /scripts/build-in-docker.sh python go sql perl
```

That is `node:22-trixie-slim`, amd64, 331 MB, created 2026-10-28. Pulling and running it by digest works. Inside the container the script sets `HOME=/tmp/home`, `TREE_SITTER_WASI_SDK_PATH=/toolchain/wasi-sdk` and `TREE_SITTER_BINARYEN_PATH=/toolchain/binaryen`. It runs `tree-sitter generate --abi 15` only where `src/parser.c` is missing, then `tree-sitter build --wasm -o /out/tree-sitter-<key>.wasm /work/<key>`.

### 1.3 Sources, outputs and cost

Archives are GitHub codeload tarballs at the tagged commit. Each was extracted into its own directory and built from a copy.

| Key | Repo, tag, commit | Archive sha256 | Generate | wasm bytes | wasm sha256 (prefix) |
| :--- | :--- | :--- | :--- | ---: | :--- |
| python | tree-sitter/tree-sitter-python v0.25.0 `293fdc02038ee2bf0e2e206711b69c90ac0d413f` | `b74d8ba6730535354175436208fe1452fd464f235263959ca40b8bf32cb23dc6` | no (upstream parser.c, CLI 0.25.9, ABI 15) | 456,723 | `3523e4dc3d12` |
| go | tree-sitter/tree-sitter-go v0.25.0 `1547678a9da59885853f5f5cc8a99cc203fa2e2c` | `a71543d63f82b917457f47a3f6dbecd8087592fabc49a757da82c3e00c0e93de` | no | 217,764 | `058a4f6c7cb7` |
| sql | DerekStride/tree-sitter-sql v0.3.11 `7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8` | `5b56eb33fcfb2b3425071ef96c935c7d6942c97954b1f83053863b9ad0dc6e94` | yes (node) | 2,472,286 | `836e4d429bbb` |
| perl | tree-sitter-perl/tree-sitter-perl v2.0.3 `d0a9590e3150543032a3b1703fd082b3f4656e45` | `86f225cb222a938b3f98ab7bcf350a87f8314d5099b35bb08a4056a8bf8a929f` | yes (node or native) | 4,722,422 | `5804566afc01` |

Timings inside the container: generate sql 28.5 s, generate perl 6.3 s; build python 3.9 s, go 2.2 s, sql 17.0 s, perl 20.7 s. Generated `parser.c` is 17 MB for sql and 28 MB for perl. The whole four-grammar run took 84 s of wall time with a cgroup `memory.peak` of 679 MB. The extracted toolchain is 953 MB on disk (wasi-sdk 635 MB, binaryen 318 MB).

**Determinism.** All four wasm files were byte-identical across two container runs (bookworm and trixie images). python was also identical to a host build. Spec 4.8 keeps a double-build comparison advisory; on this evidence CI can expect equality and report any difference.

**ABI.** All four load with `language.abiVersion === 15`. The runtime reports `LANGUAGE_VERSION 15` and `MIN_COMPATIBLE_VERSION 13`. For pre-generated grammars the ABI comes from upstream's `parser.c` (python's was generated by CLI 0.25.9), not from our CLI. If shared ABI must mean "generated by 0.27.1", the lock must set `generate: true` for every grammar.

## 2. web-tree-sitter 0.27.1 API, confirmed by running code

The scripts are `proto/api-check.mjs`, `proto/api-check2.mjs` and `proto/sync-init.mjs`.

| API | Result |
| :--- | :--- |
| `Parser.init({ locateFile })` | Works; `locateFile` is called with `web-tree-sitter.wasm`. Runtime wasm sha256 `beca80e44cccbf2299ed4d1e3fa6462a9a6fe818aeebf847547a392227ce4acc`. |
| `Language.load(Uint8Array)` | Works for all four; `abiVersion`, `name` and `types` populated. An out-of-range ABI throws `Incompatible language version N. Compatibility range 13 through 15.`, which maps to `abi-mismatch`. |
| `Language.loadSync(WebAssembly.Module)` | Exists and works, but only after `Parser.init` has resolved. |
| `new Query(lang, src)` | Bad node names throw `QueryError: Bad node name 'no_such_node'`, which maps to `query-error:<dir>/<file>:<row>`. |
| Predicates | `#eq?`, `#match?` and `#any-of?` are applied by the binding, so non-matching patterns are dropped from `matches()`. They are consumed and do not appear in `predicatesForPattern()`. Unknown predicates such as `#chemx-custom! @id "arg"` are not applied; they come back from `predicatesForPattern(i)` as `{ operator, operands: [{type:'capture',name}, {type:'string',value}] }`, and the engine must evaluate them itself. |
| `#set!` | Surfaces as `match.setProperties`: `(#set! chemx.kind "function")` gives `{ "chemx.kind": "function" }`, and `(#set! chemx.skip)` gives `{ "chemx.skip": null }`. |
| `parse(src, null, { progressCallback })` | Returning `true` cancels: `parse` returns `null`. After that, `parser.reset()` is required before reuse. Callback cadence is about 6,200 calls per 460 KB. Overhead is within noise (typing.py 47.3 ms without the callback, 43.5 ms with it). The d.ts types the option as `=> void`, but returning `true` still cancels. |
| `tree.delete()` | Works. A double `delete()` does not throw, and reading `rootNode` after delete does not throw either (undefined behavior). The engine must delete in `finally` and never touch a tree afterward. |
| Columns | With JS string input, `startIndex` and `Point.column` are **UTF-16 code units**, not bytes: on `x = "😀é"; y = 1`, `y` has column 11 = its JS index, while its UTF-8 byte offset is 14. |
| Sync in-process use | Not possible: `new Parser()` before the `init()` promise resolves throws `cannot construct a Parser before calling init()`, even with a synchronous `instantiateWasm`. The synchronous entry points therefore need the bridge (or plan B). |

**Gotcha: CJS resolution.** `createRequire(...).resolve('web-tree-sitter')` returns `web-tree-sitter.cjs`. Importing that file gives `LANGUAGE_VERSION` and `MIN_COMPATIBLE_VERSION` as snapshot values (`undefined`, because they are set during init). The ESM entry `web-tree-sitter.js` exports live bindings (15 and 13 after init). `grammar-locate.js` and the worker must resolve the ESM file, for example `<dir>/node_modules/web-tree-sitter/web-tree-sitter.js` or `import.meta.resolve` from the grammars package, or must not rely on those two exports.

## 3. Measurements

Prototype: `proto/bridge.mjs` (main side) and `proto/ts-worker.mjs` (worker). The protocol is the one in spec 4.6:

- Each call stores 0 in an `Int32Array(SharedArrayBuffer(4))` flag, posts `{ id, op, payload }` on a `MessagePort`, then calls `Atomics.wait(flag, 0, 0, timeout)` and `receiveMessageOnPort`. A short spin covers an empty port.
- The worker awaits `Parser.init` once, runs the op, posts `{ id, result | error }`, then stores 1 in the flag and calls `Atomics.notify`.
- Both the worker and the port are unref'd, so scripts exit naturally.

Benchmarks: `proto/bench.mjs` (output in `proto/bench-run1.json`), `proto/rss.mjs`, `proto/overhead.mjs`, `proto/cold-one.mjs` and `proto/nested.mjs`.

### 3.1 Bridge round trip (no parse)

| Case | p50 | p95 | p99 | max |
| :--- | ---: | ---: | ---: | ---: |
| `ping`, main thread, 20,000 calls | 0.016 ms | 0.023 ms | 0.032 ms | 0.60 ms |
| `echo` of a 50 KB source string, 2,000 calls | 0.037 ms | 0.094 ms | 0.24 ms | 1.07 ms |
| `ping` nested under the offload worker, 5,000 calls × 5 runs | 0.024–0.040 ms | 0.038–0.096 ms | n/a | n/a |

### 3.2 Cold worker spawn plus runtime init

`new Worker` up to the reply to the first op (import of `web-tree-sitter` plus `Parser.init`):

- Main thread, 15 sequential spawns: p50 97 ms, p95 116 ms.
- Inside the worker (import plus init only): p50 44 ms, p95 56 ms.
- Nested under the offload worker: 102 to 168 ms (5 runs).

### 3.3 Grammar compile (load) cost

Cold worker for each sample, 5 samples. `Language.load` compiles lazily (V8 Liftoff), so this is cheap and the first parse pays for tier-up.

| Grammar | wasm MB | `Language.load` p50 | ms per MB | Kit query compile |
| :--- | ---: | ---: | ---: | ---: |
| python | 0.44 | 4.2 ms | 9.7 | 9.7 ms (upstream tags.scm) |
| go | 0.21 | 4.0 ms | 19.2 | 6.3 ms (upstream tags.scm) |
| sql | 2.36 | 8.1 ms | 3.4 | 26.2 ms |
| perl | 4.50 | 12.0 ms | 2.7 | 20.9 ms |

The first parse after a load runs 1.0 to 2.3 times slower than warm parses: typing.py 107 ms first against 47 ms warm, proc.go 47 against 49, Simple.pm 287 against 238.

### 3.4 Parse and extraction throughput (warm, one worker, median of 5 passes)

| File | Lines | KB | Rows | Parse | Query | Wall incl. bridge | Parse ms/MB |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| argparse.py | 2,678 | 99 | 177 | 30.8 | 8.1 | 41.2 | 318 |
| typing.py | 3,461 | 115 | 323 | 34.2 | 8.5 | 46.8 | 305 |
| proc.go | 4,204 | 116 | 149 | 40.1 | 13.4 | 56.7 | 354 |
| value.go | 2,527 | 72 | 157 | 27.4 | 9.3 | 38.1 | 390 |
| information_schema.sql | 3,047 | 113 | 81 | 47.5 | 7.9 | 60.2 | 431 |
| CPAN.pm | 4,122 | 145 | 94 | 187.0 | 4.8 | 194.2 | 1,321 |
| Simple.pm | 1,644 | 54 | 63 | 205.0 | 5.2 | 211.3 | 3,888 |

Python, Go and SQL run at about 3 MB/s. Perl, with its heavy external scanner, runs at 0.25 to 0.75 MB/s. A 1 MiB Python file parsed in 597 ms and a 4 MiB one in 2,541 ms. A pathological flat file (`x = 1` × 200,000 lines, 1.2 MB) took 4.2 s.

### 3.5 RSS with four grammars (fresh process, one bridge)

Process RSS covers all threads:

| Step | RSS |
| :--- | ---: |
| Before spawn | 45.4 MB |
| After spawn plus init | 73.5 MB |
| After loading python, go, sql, perl | 79.8, 81.2, 96.1, 109.7 MB |
| After the corpus × 3 | 127.2 MB |
| After a 1 MiB Python file | 155.7 MB |
| After a 4 MiB Python file | 260.9 MB |
| After the corpus again | 261.8 MB (WASM memory never shrinks) |
| After `worker.terminate()` | 80.2 MB |

The worker's own `process.memoryUsage()` at the end: heapUsed 44 MB, external 98.7 MB (WASM linear memory counts as external), arrayBuffers 0.

### 3.6 Cold single file in a fresh process (spawn, init, first load, first parse, query)

Medians of 5 runs:

| File | Wall | Parse | Main-thread CPU | Worker-thread CPU | Process CPU |
| :--- | ---: | ---: | ---: | ---: | ---: |
| argparse.py | 239 ms | 67 ms | 56 ms | 231 ms | 609 ms |
| proc.go | 290 ms | 87 ms | 58 ms | 258 ms | 709 ms |
| information_schema.sql | 407 ms | 146 ms | 68 ms | 386 ms | 1,024 ms |
| Simple.pm | 495–767 ms | 294–470 ms | 71 ms | 751 ms | 1,373–2,013 ms |

Process CPU runs 2 to 3 times the sum of the two threads, because V8 compiles wasm tiers on background threads. `Atomics.wait` costs no CPU on the calling thread.

### 3.7 Timeouts and cancellation

- **Bridge backstop.** An op spinning for 5 s with a 500 ms call timeout returned `{ skipped: 'timeout' }` at 500 ms. The worker was terminated, and the next call respawned it in 117 ms.
- **In-worker cancel.** A 2.4 MB pathological Python file with a 200 ms `progressCallback` budget returned `skipped: 'timeout'` after 238 ms wall. The worker survived, so no respawn or grammar recompile was needed.

### 3.8 Nested worker under the MCP offload worker

`proto/nested.mjs` imports the kit's real `cli/mcp/worker-run.js` `runWorker` (the offload path: `stdout`/`stderr` piped, no `resourceLimits`). It spawns `proto/offload-sim-worker.mjs`, which builds the bridge (the nested worker), runs 5,000 pings and extracts the corpus twice.

- **Five sequential runs.** All five completed with identical row counts (2,124) and one spawn each. The process thread count was 7 before and 7 after.
- **Abort.** An `AbortSignal` abort 400 ms into a long job rejected with `audit cancelled`. Threads went from 9 during the job back to 7, so terminating the offload worker also ends its nested bridge worker and interrupts its `Atomics.wait`.
- **Timeout.** A `runWorker` timeout of 300 ms rejected with `audit timed out after 300 ms`, and threads went back to 7.

## 4. Plan A or plan B (spec 4.6 criteria)

| Criterion | Required | Measured | Verdict |
| :--- | :--- | :--- | :--- |
| Bridge round trip p50 | ≤ 0.5 ms | 0.016 ms main thread; 0.024–0.040 ms nested | pass, 12× to 30× headroom |
| Nesting under the offload worker is stable | stable | 5/5 runs, no leaked threads after abort or timeout | pass |

**Plan A.** Build `cli/treesitter/bridge.js` as specified. Plan B (async prepare and the P3-9 boundary list) is not needed. The sync-init probe in section 2 also shows there is no third option: web-tree-sitter cannot be used in-thread from a synchronous entry point.

Refinements to carry into P1 (all within spec 4.6, no new architecture):

1. **Cancel in the worker first.** The worker passes `progressCallback: () => elapsed > timeBudgetMs` and returns `skipped: 'timeout'`, keeping its compiled grammars. The bridge's `Atomics.wait` timeout becomes a backstop at `timeBudgetMs + 1000` ms that terminates the worker (for a stuck external scanner, which `progressCallback` cannot interrupt).
2. **Recycle on WASM memory, not RSS.** Recycle when the worker's `process.memoryUsage().external` exceeds 256 MB, checked after each op. A recycle costs one spawn (about 100 ms) plus 10 to 35 ms per grammar reloaded with its queries.
3. Resolve the ESM `web-tree-sitter.js`, not the CJS build (section 2).
4. Do not convert columns: they are already UTF-16 (section 2).

## 5. Budget numbers for spec section 7

These replace the (est.) rows. CPU budgets should be measured as calling-thread plus bridge-worker-thread CPU (`process.threadCpuUsage()`, available in Node 22.23), not process CPU, because V8's background wasm tier-up inflates process CPU 2 to 3 times (section 3.6).

| Scope | Was | Proposed | Evidence |
| :--- | :--- | :--- | :--- |
| Worker spawn plus runtime init | ≤ 150 ms (est.) | ≤ 150 ms p50 (measured) | p50 97, p95 116 ms; nested 102–168 ms |
| First grammar load (`Language.load` plus kit query compile) | ≤ 80 ms under 1 MB, ≤ 300 ms for 3–6 MB (est.) | ≤ 80 ms under 1 MB, ≤ 150 ms for 1–6 MB | python 14 ms, go 10 ms, sql 34 ms, perl 33 ms |
| Bridge round trip, excluding parse | p50 ≤ 0.5 ms | p50 ≤ 0.1 ms, p95 ≤ 0.5 ms with a 50 KB payload | 0.016 / 0.023 ms; 50 KB 0.037 / 0.094 ms |
| One warm file up to 2,000 lines | ≤ 400 ms | unchanged | 2.5k–4.2k-line py/go/sql files 38–60 ms; perl 1.6k lines 211 ms |
| Single-file gate path, cold | ≤ 1,500 ms | unchanged, measured as thread CPU | tree-sitter share 239–767 ms wall, 287–822 ms thread CPU |
| Worker heap | recycled above 512 MB (est.) | recycle when worker `external` > 256 MB | external 98.7 MB after a 4 MiB file; RSS 261 MB |
| Per-file parse budget (new row) | `timeBudgetMs` 2,000 | unchanged; in-worker cancel, bridge backstop at budget + 1,000 ms | cancel 238 ms for a 200 ms budget; backstop exact, respawn 117 ms |
| Perl `maxBytes` (new row) | 1 MiB default | 512 KiB for perl | perl 1.3–3.9 s/MB would hit the 2 s budget above about 0.5 MB |
| Grammar build (CI, new row) | n/a | ≤ 5 min and ≤ 2 GB for the extended tier per container run | 4 grammars 84 s, 679 MB peak |

## 6. Deviations from the spec (posted on #6839)

1. **Spec 4.8, 10.5, 10.13 (emsdk image).** tree-sitter-cli 0.27.1 uses wasi-sdk 34 clang plus binaryen 132 `wasm-opt`, not emscripten, and runs no container. `grammars.lock.json` should pin the wasi-sdk and binaryen release assets by sha256 (section 1.1) and the builder image digest `node@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f` instead of an "emsdk image digest". `scripts/build.mjs` must pre-fetch both toolchains and set `TREE_SITTER_WASI_SDK_PATH` and `TREE_SITTER_BINARYEN_PATH`, and should run with `--network none`.
2. **Spec 4.5 (columns).** "The engine converts tree-sitter byte points" is wrong for web-tree-sitter with string input: points and indices are already UTF-16 code units. Converting again would corrupt columns. The non-ASCII fixture should assert that no conversion happens.
3. **Spec 4.8 (generate list).** Perl v2.0.3 has no `src/parser.c` at the tag (the repo's `release` branch carries one, checked through the GitHub contents API), so perl needs `generate: true` alongside SQL and Swift. SQL needs node for generate; `--js-runtime native` (QuickJS) works for perl and python.
4. **Spec 4.8 (shared ABI).** Pre-generated grammars carry upstream's generator ABI (python: CLI 0.25.9, ABI 15). Building with CLI 0.27.1 does not change it; the manifest should record `abiVersion` from `Language.load` per grammar.
5. **Spec 7 (worker heap).** The cap should track worker `external` (WASM memory) at 256 MB instead of 512 MB RSS (section 5).

## 7. Reproduce

Scratch root: `/tmp/claude-1000/-home-xopher-www-x-Xophz-COMPASS-apps-chemical-x-starter-kit/7f7174e0-678e-4bec-8662-dc0a043a22dc/scratchpad/ts-spike/`. It holds `package.json` with `web-tree-sitter` 0.27.1 exact, installed with `--ignore-scripts`; `cli/` (the CLI 0.27.1 release asset); `toolchain/` (wasi-sdk, binaryen); `archives/` and `src/` (pinned grammar sources); `scripts/build-in-docker.sh`; `wasm-trixie/` (built wasm); `corpus/`; and `proto/`. The corpus is system files (Python 3.12 stdlib `argparse.py` and `typing.py`, Perl 5.38 `CPAN.pm` and `Pod/Simple.pm`, PostgreSQL 17 `information_schema.sql`) plus tree-sitter-go's `examples/`.

```
node proto/api-check.mjs  <root>      # section 2
node proto/api-check2.mjs <root>
node proto/sync-init.mjs  <root>
node proto/bench.mjs      <root>      # 3.1-3.4, 3.7
node proto/rss.mjs        <root>      # 3.5
node proto/overhead.mjs   <root>      # first-parse and progressCallback overhead
node proto/cold-one.mjs   <root> python argparse.py    # 3.6
node proto/nested.mjs     <root> <kit dir>             # 3.8
```
