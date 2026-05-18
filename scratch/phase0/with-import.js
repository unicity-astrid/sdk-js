// The integration-shape question: what does ComponentizeJS emit
// for host imports? The TypeScript types (`types.d.ts`) reveal that imports
// in the WIT world become module imports on the JS side, addressed by the
// fully-qualified WIT identifier.
//
// For an interface `host` in package `phase0:with-import@0.1.0`, the JS
// import specifier is `phase0:with-import/host`.

import { log, add } from "phase0:with-import/host@0.1.0";

export function greet() {
  log({ tag: "info" }, "greet called");
  return "hello from host-import-aware component";
}

export function runTests() {
  log({ tag: "info" }, "running test scenarios");
  const sum = add(40, 2);
  log({ tag: "info" }, `add(40, 2) = ${sum}`);
  log({ tag: "warn" }, "this is a warn log");
  try {
    log({ tag: "error" }, "this is an error log");
  } catch (e) {
    return `caught while logging: ${e?.message ?? e}`;
  }
  return `add(40, 2) = ${sum}; logs emitted`;
}
