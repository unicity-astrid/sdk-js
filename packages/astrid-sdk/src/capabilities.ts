/**
 * Capability introspection. Mirrors `astrid_sdk::capabilities`.
 *
 * {@link check} asks whether a capsule (self or any other, by IPC session
 * UUID) holds a specific manifest capability — used by the prompt builder to
 * enforce `allow_prompt_injection` gating, for example. {@link enumerate} is
 * the list dual for the calling capsule's own set: the names for which a
 * self-`check` returns `true`. Capability posture is structural metadata, not
 * a secret (enforce-don't-conceal), so both are ungated.
 *
 * Fail-closed: `check` returns `false` for unknown UUIDs, unknown
 * capabilities, or registry-unavailable conditions (the host returns
 * `registry-unavailable`, which `callHost` raises as a SysError — capsule code
 * that wants to swallow registry outages should wrap the call).
 */

import { checkCapsuleCapability, enumerateCapabilities } from "astrid:sys/host@1.0.0";
import { callHost } from "./errors.js";

export function check(sourceUuid: string, capability: string): boolean {
  const resp = callHost(`capabilities.check(${JSON.stringify(capability)})`, () =>
    checkCapsuleCapability({ sourceUuid, capability }),
  );
  return resp.allowed;
}

/**
 * Enumerate the calling capsule's own held capability names.
 *
 * Returns the capability categories declared in this capsule's
 * `[capabilities]` manifest block (`host_process`, `net_connect`, `fs_read`,
 * …) — the names, not the scoped arguments within them (allowlists,
 * `host:port`, paths). This is exactly the set of names for which
 * {@link check} against this capsule's own UUID returns `true`.
 *
 * Argument-free (the kernel already knows the caller) and infallible: an empty
 * array is the valid "no capabilities" answer. Lets a reusable capsule ground
 * its behaviour in what it can actually do instead of hard-coding it, avoiding
 * code-vs-manifest drift.
 */
export function enumerate(): string[] {
  return callHost("capabilities.enumerate", () => enumerateCapabilities());
}
