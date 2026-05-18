/**
 * Multi-platform identity resolution and linking. Mirrors `astrid_sdk::identity`.
 *
 * Requires the `identity` capability in `Capsule.toml`:
 *   `["resolve"]` — resolve platform users
 *   `["link"]`    — resolve, link, unlink, list-links
 *   `["admin"]`   — all of the above + create new users
 */

import {
  identityResolve as hostResolve,
  identityLink as hostLink,
  identityUnlink as hostUnlink,
  identityCreateUser as hostCreateUser,
  identityListLinks as hostListLinks,
  type IdentityOkResponse,
} from "astrid:capsule/identity@0.1.0";
import { SysError, callHost } from "./errors.js";

export interface ResolvedUser {
  userId: string;
  displayName: string | undefined;
}

export interface Link {
  platform: string;
  platformUserId: string;
  astridUserId: string;
  linkedAt: string;
  method: string;
}

/** Resolve a platform identity to an Astrid user, or `undefined` if no link exists. */
export function resolve(platform: string, platformUserId: string): ResolvedUser | undefined {
  const resp = callHost(`identity.resolve(${JSON.stringify(platform)})`, () =>
    hostResolve({ platform, platformUserId }),
  );
  if (resp.found) {
    if (typeof resp.userId !== "string") {
      throw SysError.api("identity.resolve: host returned found=true with missing userId");
    }
    return { userId: resp.userId, displayName: resp.displayName };
  }
  if (resp.error !== undefined) {
    throw SysError.api(`identity.resolve: ${resp.error}`);
  }
  return undefined;
}

/** Link a platform identity to an Astrid user. */
export function link(
  platform: string,
  platformUserId: string,
  astridUserId: string,
  method: string,
): void {
  const resp = callHost("identity.link", () =>
    hostLink({ platform, platformUserId, astridUserId, method }),
  );
  requireOk("identity.link", resp);
}

/** Unlink a platform identity. Returns `true` if a link was removed. */
export function unlink(platform: string, platformUserId: string): boolean {
  const resp = callHost("identity.unlink", () => hostUnlink({ platform, platformUserId }));
  requireOk("identity.unlink", resp);
  return resp.removed === true;
}

/** Create a new Astrid user. Returns the new user UUID. */
export function createUser(displayName?: string): string {
  const resp = callHost("identity.createUser", () => hostCreateUser({ displayName }));
  requireOk("identity.createUser", resp);
  if (typeof resp.userId !== "string") {
    throw SysError.api("identity.createUser: missing userId in response");
  }
  return resp.userId;
}

/** List all platform links for an Astrid user. */
export function listLinks(astridUserId: string): Link[] {
  const resp = callHost("identity.listLinks", () => hostListLinks({ astridUserId }));
  requireOk("identity.listLinks", resp);
  if (resp.linksJson === undefined) return [];
  try {
    const parsed = JSON.parse(resp.linksJson) as Array<{
      platform: string;
      platform_user_id: string;
      astrid_user_id: string;
      linked_at: string;
      method: string;
    }>;
    return parsed.map((l) => ({
      platform: l.platform,
      platformUserId: l.platform_user_id,
      astridUserId: l.astrid_user_id,
      linkedAt: l.linked_at,
      method: l.method,
    }));
  } catch (err) {
    throw SysError.json(`identity.listLinks: ${(err as Error).message}`, err);
  }
}

function requireOk(label: string, resp: IdentityOkResponse): void {
  if (resp.ok) return;
  throw SysError.api(`${label}: ${resp.error ?? "operation failed"}`);
}
