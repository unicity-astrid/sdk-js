/**
 * Interceptor binding registry — metadata for the kernel-managed
 * interceptor subscriptions a capsule declared in `Capsule.toml`.
 *
 * Mirrors `astrid_sdk::interceptors`. Under the per-domain ABI, interceptor
 * events are delivered to the capsule via `astrid-hook-trigger` rather than
 * a run-loop IPC subscription. The host fn `get-interceptor-bindings` returns
 * metadata-only — capsules use it to enumerate the `(action, topic)` pairs
 * they're subscribed to for debugging, introspection, and tooling. `handle`
 * is the kernel-side registry handle (for log correlation only); it is NOT
 * convertible into an `ipc.Subscription`.
 */

import { runtimeInterceptors, type InterceptorBinding } from "./ipc.js";

export type { InterceptorBinding } from "./ipc.js";

/**
 * Query the runtime for auto-subscribed interceptor handles. Returns an
 * empty array if this capsule has no auto-subscribed interceptors (i.e. it
 * does not have both `@run` and `[[interceptor]]`).
 */
export function bindings(): InterceptorBinding[] {
  return runtimeInterceptors();
}
