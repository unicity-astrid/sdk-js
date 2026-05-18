/**
 * Hook fan-out triggers. Mirrors `astrid_sdk::hooks`.
 *
 * Calling `trigger(event)` causes the kernel to dispatch the event to all
 * capsules with matching interceptors and return their aggregated
 * responses as JSON.
 */

import { triggerHook } from "astrid:capsule/sys@0.1.0";
import { callHost } from "./errors.js";

/**
 * Trigger an interceptor fan-out. `event` is a JSON request string per the
 * WIT contract: `{ "hook": "topic", "payload": {...} }`. Returns a JSON
 * array of interceptor responses.
 */
export function trigger(event: string): string {
  return callHost("hooks.trigger", () => triggerHook(event));
}
