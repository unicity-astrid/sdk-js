/**
 * Human-in-the-loop approval. Mirrors `astrid_sdk::approval`.
 *
 * The capsule declares the action and target resource. The kernel
 * classifies risk, checks any pre-approved allowances, and either auto-
 * approves or prompts the frontend user. The capsule sees only the
 * approved/denied verdict.
 */

import { requestApproval as hostRequestApproval } from "astrid:capsule/approval@0.1.0";
import { callHost } from "./errors.js";

/**
 * Request approval for a sensitive action. Returns `true` if approved
 * (either by an existing allowance or fresh user prompt), `false` if
 * denied. Blocks until the user responds or the request times out (60s).
 */
export function request(action: string, resource: string): boolean {
  const resp = callHost(`approval.request(${JSON.stringify(action)})`, () =>
    hostRequestApproval({ action, targetResource: resource }),
  );
  return resp.approved;
}
