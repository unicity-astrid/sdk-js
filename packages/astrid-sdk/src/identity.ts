/**
 * Multi-platform identity resolution and linking. Mirrors `astrid_sdk::identity`.
 *
 * Required capability in `Capsule.toml`:
 *   `["resolve"]` — resolve platform users
 *   `["link"]`    — resolve, link, unlink, list-links
 *   `["admin"]`   — all of the above + create new users
 *
 * Post per-domain WIT split, the host returns typed records directly (no
 * `linksJson` blob, no `ok` flags). Errors surface as `SysError` with
 * `code` set to the WIT variant (`link-not-found`, `already-linked`, etc.).
 *
 * The {@link resolve} helper preserves the pre-migration "absent → undefined"
 * shape by catching `link-not-found` and returning `undefined`. Other errors
 * propagate.
 */

import {
  identityResolve as hostResolve,
  identityLink as hostLink,
  identityUnlink as hostUnlink,
  identityCreateUser as hostCreateUser,
  identityListLinks as hostListLinks,
} from "astrid:identity/host@1.0.0";
import { SysError, callHost } from "./errors.js";

export interface ResolvedUser {
  userId: string;
  displayName: string | undefined;
}

export interface Link {
  platform: string;
  platformUserId: string;
  /** ISO 8601 timestamp the link was created. */
  linkedAt: string;
  /** Auth method used at link time (e.g. "passkey", "token"). */
  method: string;
}

/**
 * Resolve a platform identity to an Astrid user, or `undefined` if no link
 * exists. Other identity errors (capability-denied, store-unavailable, etc.)
 * propagate as `SysError`.
 */
export function resolve(platform: string, platformUserId: string): ResolvedUser | undefined {
  try {
    const resp = callHost(`identity.resolve(${JSON.stringify(platform)})`, () =>
      hostResolve({ platform, platformUserId }),
    );
    return { userId: resp.userId, displayName: resp.displayName };
  } catch (err) {
    if (err instanceof SysError && err.code === "link-not-found") return undefined;
    throw err;
  }
}

/** Link a platform identity to an Astrid user. */
export function link(
  platform: string,
  platformUserId: string,
  astridUserId: string,
  method: string,
): void {
  callHost("identity.link", () =>
    hostLink({ platform, platformUserId, astridUserId, method }),
  );
}

/**
 * Unlink a platform identity. Returns `true` if a link was removed,
 * `false` if there was nothing to remove.
 */
export function unlink(platform: string, platformUserId: string): boolean {
  try {
    callHost("identity.unlink", () => hostUnlink({ platform, platformUserId }));
    return true;
  } catch (err) {
    if (err instanceof SysError && err.code === "link-not-found") return false;
    throw err;
  }
}

/** Create a new Astrid user. Returns the new user UUID. */
export function createUser(displayName?: string): string {
  const resp = callHost("identity.createUser", () =>
    hostCreateUser({ displayName }),
  );
  return resp.userId;
}

/** List all platform links for an Astrid user. */
export function listLinks(astridUserId: string): Link[] {
  const links = callHost("identity.listLinks", () => hostListLinks(astridUserId));
  return links.map((l) => ({
    platform: l.platform,
    platformUserId: l.platformUserId,
    linkedAt: l.linkedAt,
    method: l.method,
  }));
}
