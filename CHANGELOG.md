# Changelog

All notable changes to `@astrid-os/sdk` and `@astrid-os/build` are documented
in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-05-26

First non-prerelease. `0.1.0-alpha.0` was the test version; this is the
first release intended for capsule consumers. The contract surface is
the per-domain WIT host ABI introduced alongside the merged
`unicity-astrid/wit` 1.0.0 packages.

### Breaking

- **Per-domain WIT host ABI.** The monolithic `astrid:capsule@0.1.0` world has
  been split into per-domain frozen packages at `@1.0.0`:
  `astrid:fs/host`, `astrid:ipc/host`, `astrid:kv/host`, `astrid:net/host`,
  `astrid:http/host`, `astrid:sys/host`, `astrid:process/host`,
  `astrid:uplink/host`, `astrid:elicit/host`, `astrid:approval/host`,
  `astrid:identity/host`. Foundation I/O is Astrid-owned (no `wasi:io`
  dependency) and lives in `astrid:io/{error,poll,streams}@1.0.0`. Guest
  exports are split into per-export worlds under `astrid:guest@1.0.0`.
- **Resource-backed handles.** Previously-opaque `u64` handles
  (`Subscription`, `FileHandle`, `TcpStream`, `UnixListener`, `ProcessHandle`,
  `HttpStream`, `Pollable`, `InputStream`, `OutputStream`, `Error`) are now
  Component Model resources. SDK wrappers expose them as TypeScript classes
  implementing `Symbol.dispose` so `using sub = ipc.subscribe(...)` releases
  the resource on scope exit. An explicit `.close()` remains available for
  codebases not yet on the explicit-resource-management proposal.
- **Typed `ErrorCode` enums per domain.** Every host fn now returns
  `result<T, error-code>` where `error-code` is a domain-specific variant
  (`astrid:fs/host.error-code`, `astrid:net/host.error-code`, …). `SysError`
  now carries the WIT variant tag on `code` — downstream code can branch
  `if (err.code === "quota") ...` without losing the typed kind. The legacy
  origin classification moved to `SysError.kind`.
- **`fs` module gained the full POSIX surface.** `open` returns a
  `FileHandle` resource with `readAt`/`writeAt`/`syncData`/`syncAll`/`stat`/
  `setLen`. New top-level helpers: `mkdirAll`, `appendFile`, `copy`, `rename`,
  `removeDirAll`, `canonicalize`, `readLink`, `hardLink`, `lstat`. `Stats`
  now exposes `kind`, `mode`, `birthtimeMs`, `atimeMs`, `isSymbolicLink()`.
- **`net` module split into `UnixListener` / `TcpListener` / `TcpStream` /
  `UdpSocket` resources.** New surface: `bindTcp`, `udpBind`, `lookupHost`,
  `TcpStream.{setHopLimit, setKeepalive, setLinger, setReuseaddr,
  readStream, writeStream}`, `UdpSocket.{sendTo, recvFrom, connect, send,
  recv}`. `StreamHandle`/`ListenerHandle` survive as aliases for source
  compatibility.
- **`http.HttpStreamHandle` is now a resource handle** with `subscribeReadable`
  and `bodyStream` for splice-based body forwarding. `HttpMethod` is now a
  variant tag at the WIT layer; the SDK still accepts uppercase strings.
- **`process.BackgroundProcessHandle` gained the full lifecycle surface**:
  `writeStdin`, `closeStdin`, `signal`, `wait`, `waitWithOutput`, `osPid`,
  `subscribeExit`, `subscribeLogs`. `ProcessResult.exitCode` is now
  `number | undefined` (a Unix-signal kill returns `undefined` exit code and
  populates the new `signal` field).
- **`identity` module returns typed `PlatformLink[]` directly** rather than
  a JSON-encoded `linksJson` blob. `IdentityOkResponse` is removed; errors
  surface as `SysError` with the WIT variant on `code`.
- **`approval` module returns the typed `ApprovalDecision`** (one-shot /
  session / always / allowance-hit / denied). New `requestDecision` surfaces
  the full decision; `request` continues to collapse to a boolean.
- **`uplink.UplinkProfile` is now an enum** (`"chat" | "interactive" |
  "notify" | "bridge"`); profile strings outside that set return
  `invalid-profile` from the host.
- **`hooks` module removed.** The `sys::trigger-hook` host fn no longer
  exists in the per-domain WIT. Hook fan-out is now performed via
  `ipc.requestResponse`. Callers that previously used `hooks.trigger(json)`
  should publish on the hook's IPC topic and await the typed response.
- **`SysError.code` semantics changed.** The legacy `code: "HostError" |
  "JsonError" | "ApiError"` field moved to `SysError.kind`; `code` now
  carries the typed WIT variant (e.g. `"capability-denied"`, `"quota"`,
  `"timeout"`). `SysErrorCode` is renamed to `SysErrorKind`.

### Added

- **`ipc.requestResponse<Req, Resp>(requestTopic, responseNamespace, request,
  timeoutMs)`** — mirrors the Rust SDK's `astrid_sdk::ipc::request_response`.
  Pre-subscribes to `<responseNamespace>.<correlationId>` before publishing,
  injects a UUIDv4 `correlation_id` into the request payload, races against
  `timeoutMs`, and always tears down the subscription. Rejects non-object
  payloads synchronously with `SysError.api`.
- **`ipc.publishAs(topic, payload, principal)` and
  `ipc.publishJsonAs(topic, value, principal)`** for uplinks asserting an
  end-user principal. Subscribers see the principal as `claimed`, not
  `verified`.
- **`ipc.IpcMessage.principal`** is now a typed `PrincipalAttribution`
  variant (`verified` / `claimed` / `system`) rather than a bare
  `string | undefined`.
- **`kv.cas(key, expected, newValue)`** for atomic compare-and-swap on
  shared keys, and `kv.listKeysPage(prefix, cursor, limit)` for paginated
  enumeration of unbounded stores.
- **`fs.open(path, mode)` + `FileHandle` resource** for streaming /
  random-access I/O without buffering the whole file.
- **`net.bindTcp`, `net.udpBind`, `net.lookupHost`** for outbound /
  inbound TCP listeners, UDP sockets, and DNS resolution.
- **`runtime.randomBytes(length)`** wrapping the host CSPRNG (audited
  via `sys::random-bytes`).
- **`time.sleepMs`, `time.sleepNs`, `time.monotonicNs`** wrapping the
  host clock / sleep primitives.
- **`env.tryGet(key)`** returns `string | undefined` so callers can
  distinguish "not set" from "set to empty string".

### Changed

- **Build orchestrator** (`@astrid-os/build`) synthesises a capsule world
  in `<projectDir>/gen/wit/capsule.wit` mirroring the Rust SDK's
  `astrid-sys` synthetic world. Capsules no longer need to declare their
  own world for the common case.
- **Contracts submodule** (`unicity-astrid/wit`) bumped to commit
  `324d4ab`, which introduces the Astrid-owned `astrid:io@1.0.0`
  foundation primitives.
