// Public API of @astrid-os/sdk.
//
// Module-by-module mirror of `astrid_sdk::prelude`, with idiom translated
// from Rust-std to Node/WHATWG conventions where appropriate. See the plan
// document at .claude/plans/hey-claude-got-task-rippling-harbor.md and
// notes/phase-2.md for the full mapping rationale.

export { SysError, type SysErrorCode } from "./errors.js";

export { capsule, install, upgrade, run } from "./capsule.js";
export {
  tool,
  interceptor,
  command,
  type ToolOptions,
  type InterceptorOptions,
  type CommandOptions,
} from "./tool.js";

// Namespaced submodules. Authors import as `import { fs, http, ipc, ... } from "@astrid-os/sdk"`
// and call `await fs.readFile(...)`, `ipc.publish(...)`, etc.
export * as log from "./log.js";
export * as kv from "./kv.js";
export * as ipc from "./ipc.js";
export * as fs from "./fs.js";
export * as http from "./http.js";
export * as net from "./net.js";
export * as process from "./process.js";
export * as env from "./env.js";
export * as time from "./time.js";
export * as runtime from "./runtime.js";
export * as hooks from "./hooks.js";
export * as capabilities from "./capabilities.js";
export * as elicit from "./elicit.js";
export * as identity from "./identity.js";
export * as approval from "./approval.js";
export * as uplink from "./uplink.js";
export * as interceptors from "./interceptors.js";

// Type re-exports for ergonomic imports.
export type { IpcMessage, PollResult, Subscription, InterceptorBinding } from "./ipc.js";
export type { Stats, Dirent } from "./fs.js";
export type {
  Request as HttpRequest,
  Response as HttpResponse,
  HttpMethod,
  HttpStreamHandle,
  StreamStart,
  FetchInit,
  FetchResponse,
} from "./http.js";
export type { ListenerHandle, StreamHandle } from "./net.js";
export type { ProcessResult, ProcessLogs, KillResult, BackgroundProcessHandle } from "./process.js";
export type { CallerContext } from "./runtime.js";
export type { ResolvedUser, Link } from "./identity.js";
export type { UplinkId } from "./uplink.js";
