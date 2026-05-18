/**
 * Cross-capsule capability queries. Mirrors `astrid_sdk::capabilities`.
 *
 * Allows a capsule to check whether another capsule (identified by its IPC
 * session UUID) has a specific manifest capability. Used by the prompt
 * builder to enforce `allow_prompt_injection` gating, for example.
 *
 * Fail-closed: returns `false` for unknown UUIDs, unknown capabilities, or
 * registry errors.
 */

import { checkCapsuleCapability } from "astrid:capsule/sys@0.1.0";
import { callHost } from "./errors.js";

export function check(sourceUuid: string, capability: string): boolean {
  const resp = callHost(`capabilities.check(${JSON.stringify(capability)})`, () =>
    checkCapsuleCapability({ sourceUuid, capability }),
  );
  return resp.allowed;
}
