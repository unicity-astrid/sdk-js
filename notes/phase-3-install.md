# Phase 3 — Install path + kernel-load smoke test

**Status:** PASSED for the install + lifecycle-hook path. Tool dispatch
round-trip deferred (requires running daemon to observe KV state).

**Date:** 2026-05-15.

## What got validated

End-to-end pipeline now proven all the way to **wasmtime running our
JS-built component inside the actual Astrid kernel**:

```
src/index.ts (TS, decorators)
  ↓ tsc → esbuild bundle → ComponentizeJS
target/test-capsule.wasm (wasip2 component, 10.93 MB)
  ↓ pack_capsule_archive
dist/test-capsule.capsule (3.5 MB gzip, Capsule.toml + wasm + wit/)
  ↓ astrid capsule install
~/.astrid/
├── bin/89d628...d3d.wasm   (BLAKE3 content-addressed)
├── wit/2618c7...554a.wit   (BLAKE3 content-addressed)
└── home/default/.local/capsules/test-capsule/
    ├── Capsule.toml
    └── meta.json           (records wasm + wit hashes, version, timestamps)
  ↓ kernel lifecycle dispatch (during install)
wasmtime::Component::from_binary OK
all 11 host interfaces (49 fns) wired in linker
astrid-install export called → bridge dispatched → user @install ran → log.info OK
```

Concrete kernel log line proving it worked:

```
INFO astrid_capsule::engine::wasm: Running lifecycle hook capsule=test-capsule phase=Install previous_version="(none)"
INFO astrid_capsule::engine::wasm: Lifecycle hook completed successfully capsule=test-capsule phase=Install
```

## Audit findings + fixes (install path)

`core/crates/astrid-cli/src/commands/capsule/install.rs:548-580`:

| # | Finding | Fix |
|---|---------|-----|
| 1 | Auto-build branch only triggered on `Cargo.toml` — JS/TS source dirs would skip building and fail | Replaced with `is_buildable_source(dir)` helper that also detects `Capsule.toml + package.json` and `openclaw.plugin.json` |
| 2 | Hardcoded `--type rust` arg passed to astrid-build | Removed; astrid-build's own `detect_project_type` (extended in Phase 1) handles all cases identically to the GitHub-clone path |
| 3 | GitHub-clone install path (line 442) — already correct, no `--type` passed | No change needed |
| 4 | Wasm content-addressing (`content_address_wasm`) | Reads `component.path` from manifest; language-agnostic. OK. |
| 5 | Kernel loader (`engine/wasm/mod.rs:776`) uses `Component::from_binary` | wasip2 Component Model native. Works for any valid component. OK. |
| 6 | Empty WasiCtx (only stderr inherited) | Fine — our JS components import zero WASI with `disableFeatures` fully on. OK. |
| 7 | `wasm_exports_contain_run` parses both core and component-model export sections | Already handled. OK. |

## Cross-repo divergence found

**`core/wit/astrid-capsule.wit` lags `sdk-rust/astrid-sys/wit/astrid-capsule.wit`** by one host function: `ipc-publish-as` (the feature from the `feat/ipc-publish-as` branch). The SDK's WIT declares it; the kernel doesn't implement it.

Symptom: a JS-built component declaring the import fails to instantiate with
```
component imports instance `astrid:capsule/ipc@0.1.0`, but a matching implementation was not found in the linker
```

Wasmtime's component linker matches whole interfaces, not individual functions. A single missing host fn fails the entire `ipc` interface match.

**Resolution applied:** aligned the JS SDK's WIT and TS code with the kernel's current state — dropped `publishAs` / `publishJsonAs` from `src/ipc.ts` and `src/wit-imports.d.ts`. Inline TODO comments in both files mark where to re-introduce them once the kernel side lands.

**Follow-up (not this PR):** add `ipc_publish_as` to `core/wit/astrid-capsule.wit` AND implement the host function in `core/crates/astrid-capsule/src/engine/wasm/host/ipc.rs`. That naturally re-enables the JS SDK additions.

## What's NOT verified yet

The install fired `astrid-install`. The remaining hook paths
(`astrid-hook-trigger` for `tool_describe`, `tool_execute_increment`, etc.)
use the **same wasmtime code path** — only the WIT export name differs.
But we haven't observed:

- A `tool_describe` round-trip producing the expected schema list.
- A `tool_execute_increment` round-trip: bridge state load → handler →
  state persist → IPC publish to `tool.v1.execute.increment.result`.
- KV state persistence between invocations. Install ran the bridge's
  `persistInstance` call but the daemon writes to ephemeral in-memory KV
  by default; the persistent SQLite/sled backend only attaches in
  `astrid start` daemon mode.

These would be best validated by:
1. Running `astrid start` to bring up the daemon
2. Issuing `/tool increment {}` via the CLI client
3. Verifying the kernel audit log shows tool_describe → tool_execute_increment → result publish, AND that a second `/tool increment {}` returns `{counter: 2}` proving state persisted.

The sandbox this dev session runs in doesn't let me start a long-running
daemon cleanly. A human-operator session can do this in a few minutes.

Same goes for runnable capsules — `@run` invocation only matters once
there's a daemon to spawn the background task.

## Plan deltas vs. the original plan

- The plan called for Phase 3 to include the schema-conformance test
  between Rust and TS test-capsules. With both pipelines producing
  artifacts now, this test is straightforward to add (parse each
  capsule's `tool_describe` payload, diff the schemas). Recommended as
  the first follow-up after daemon-mode validation passes.
- The plan called for a `--no-install` flag in `astrid-build`. Not added
  in this pass because we still run `npm install` unconditionally; the
  workspace symlinks made it transparent. Worth adding for air-gapped CI.

## Files touched this phase

- `core/crates/astrid-cli/src/commands/capsule/install.rs`
  — Added `is_buildable_source` helper. Removed Cargo-only assumption from
  auto-build branch. ~20 LOC.
- `sdk-js/packages/astrid-sdk/wit/astrid-capsule.wit`
  — Replaced with kernel's current version (sans `ipc-publish-as`).
- `sdk-js/packages/astrid-sdk/src/ipc.ts`
  — Dropped `publishAs` / `publishJsonAs` exports, TODO comment with
  re-enable conditions.
- `sdk-js/packages/astrid-sdk/src/wit-imports.d.ts`
  — Commented out `ipcPublishAs` ambient export.

## Tasks completed this phase

- #28 — Audit install path for JS/TS gaps
- #29 — Patch Rust-only assumptions
- #30 — Exercise `astrid capsule install` against the JS .capsule (PASSED)
- #31 — Kernel-load smoke test (PARTIAL — install + astrid-install validated; tool dispatch deferred to daemon mode)
