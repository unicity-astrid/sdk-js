/**
 * Interactive user input during install/upgrade. Mirrors `astrid_sdk::elicit`.
 *
 * These functions are only callable from `@install` / `@upgrade` lifecycle
 * methods; calling them from a tool or interceptor returns `not-in-lifecycle`.
 * The host blocks the WASM thread until the frontend collects input or the
 * request times out (120s).
 *
 * Post per-domain WIT split, the host returns a typed `elicit-response`
 * variant directly. We unpack it into the language-natural shape: `text` /
 * `textWithDefault` / `select` return strings; `array` returns string[];
 * `secret` returns void (the value never leaves the SecretStore).
 */

import {
  elicit as hostElicit,
  hasSecret as hostHasSecret,
  type ElicitResponse,
} from "astrid:elicit/host@1.0.0";
import { SysError, callHost } from "./errors.js";

function validateKey(key: string): void {
  if (key.trim() === "") {
    throw SysError.api("elicit key must not be empty");
  }
}

/**
 * Store a secret via the kernel's SecretStore. The capsule NEVER receives
 * the value back — verify via {@link hasSecret} and dereference at runtime
 * by name.
 */
export function secret(key: string, description: string): void {
  validateKey(key);
  const resp = callHost(`elicit.secret(${JSON.stringify(key)})`, () =>
    hostElicit({
      kind: "secret",
      key,
      description,
      options: undefined,
      defaultValue: undefined,
    }),
  );
  if (resp.tag !== "secret-stored") {
    throw SysError.api(
      `elicit.secret: expected 'secret-stored' response, got '${resp.tag}'`,
    );
  }
}

/** Check whether a secret with this key was previously stored. */
export function hasSecret(key: string): boolean {
  validateKey(key);
  return callHost(`elicit.hasSecret(${JSON.stringify(key)})`, () => hostHasSecret(key));
}

/** Prompt the user for a text value. */
export function text(key: string, description: string): string {
  return elicitText(key, description, undefined);
}

/** Prompt with a pre-filled default. */
export function textWithDefault(
  key: string,
  description: string,
  defaultValue: string,
): string {
  return elicitText(key, description, defaultValue);
}

/** Prompt for a selection from a list. */
export function select(key: string, description: string, options: string[]): string {
  validateKey(key);
  if (options.length === 0) {
    throw SysError.api("elicit.select requires at least one option");
  }
  const resp = callHost(`elicit.select(${JSON.stringify(key)})`, () =>
    hostElicit({
      kind: "select",
      key,
      description,
      options,
      defaultValue: undefined,
    }),
  );
  const value = expectValue("elicit.select", resp);
  if (options.indexOf(value) < 0) {
    throw SysError.api(
      `host returned value not in provided options: ${value.slice(0, 64)}`,
    );
  }
  return value;
}

/** Prompt for multiple text values. */
export function array(key: string, description: string): string[] {
  validateKey(key);
  const resp = callHost(`elicit.array(${JSON.stringify(key)})`, () =>
    hostElicit({
      kind: "array",
      key,
      description,
      options: undefined,
      defaultValue: undefined,
    }),
  );
  if (resp.tag !== "values") {
    throw SysError.api(`elicit.array: expected 'values' response, got '${resp.tag}'`);
  }
  return resp.val;
}

function elicitText(
  key: string,
  description: string,
  defaultValue: string | undefined,
): string {
  validateKey(key);
  const resp = callHost(`elicit.text(${JSON.stringify(key)})`, () =>
    hostElicit({
      kind: "text",
      key,
      description,
      options: undefined,
      defaultValue,
    }),
  );
  return expectValue("elicit.text", resp);
}

function expectValue(label: string, resp: ElicitResponse): string {
  if (resp.tag !== "value") {
    throw SysError.api(`${label}: expected 'value' response, got '${resp.tag}'`);
  }
  return resp.val;
}
