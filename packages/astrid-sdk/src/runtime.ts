/**
 * OS runtime introspection + signaling. Mirrors `astrid_sdk::runtime`.
 */

import {
  getCaller as hostGetCaller,
  signalReady as hostSignalReady,
} from "astrid:capsule/sys@0.1.0";
import { SysError, callHost } from "./errors.js";
import { get as getEnv, CONFIG_SOCKET_PATH } from "./env.js";

/** Information about the caller that triggered the current execution. */
export interface CallerContext {
  /** UUID of the capsule that originated the IPC message. */
  sourceId: string;
  /** The acting principal (user ID), if available. */
  principal: string | undefined;
  /** ISO 8601 timestamp of the originating message. */
  timestamp: string;
}

/**
 * Signal that the capsule's run loop is ready. Call after setting up IPC
 * subscriptions inside `@run`; the kernel waits for this before loading
 * dependent capsules.
 */
export function signalReady(): void {
  callHost("runtime.signalReady", () => hostSignalReady());
}

/** Caller context for the current invocation. */
export function caller(): CallerContext {
  const ctx = callHost("runtime.caller", () => hostGetCaller());
  return {
    sourceId: ctx.sourceId,
    principal: ctx.principal,
    timestamp: ctx.timestamp,
  };
}

/**
 * Kernel's Unix domain socket path, injected via the well-known
 * `ASTRID_SOCKET_PATH` config key.
 */
export function socketPath(): string {
  const path = getEnv(CONFIG_SOCKET_PATH);
  if (path === "") {
    throw SysError.api("ASTRID_SOCKET_PATH config key is empty");
  }
  if (path.indexOf("\0") >= 0) {
    throw SysError.api("ASTRID_SOCKET_PATH contains null byte");
  }
  return path;
}
