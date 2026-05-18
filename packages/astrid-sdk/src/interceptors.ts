/**
 * Auto-subscribed interceptor bindings for run-loop capsules. Mirrors
 * `astrid_sdk::interceptors`.
 *
 * When a capsule declares both `@run` AND `@interceptor`, the kernel
 * pre-registers IPC subscriptions for each interceptor topic and the
 * `@run` loop reads from those bindings via the IPC bus. The
 * `@interceptor` decorator handles dispatch automatically; this module
 * is for advanced authors who want to drive the loop manually.
 */

import { runtimeInterceptors, type InterceptorBinding, type PollResult } from "./ipc.js";
import * as ipc from "./ipc.js";

export type { InterceptorBinding } from "./ipc.js";

/** Query the runtime for auto-subscribed interceptor handles. */
export function bindings(): InterceptorBinding[] {
  return runtimeInterceptors();
}

/**
 * Poll all interceptor subscriptions and dispatch pending events.
 * Bindings with no pending messages are skipped. Mirrors
 * `astrid_sdk::interceptors::poll`.
 */
export function poll(
  bindings: InterceptorBinding[],
  handler: (action: string, batch: PollResult) => void,
): void {
  for (const b of bindings) {
    const sub = ipc.subscribe(b.topic); // re-use the existing handle implicitly via the host
    try {
      const result = sub.poll();
      if (result.messages.length > 0) {
        handler(b.action, result);
      }
    } finally {
      // Don't close the subscription — these are runtime-owned handles
      // the kernel manages. Subscription.close() ignores the underlying
      // error for those cases.
      sub.close();
    }
  }
}
