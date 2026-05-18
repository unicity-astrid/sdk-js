/**
 * Full TS port of `sdk-rust/examples/test-capsule`. Exercises every Phase 2
 * SDK surface: `@tool` (mutable + stateless), `@interceptor`, `@install`,
 * `@upgrade`, WIT-typed event publishing via `ipc.publishJson`, and a
 * `wit_events`-derived TS type.
 */

import { capsule, tool, interceptor, install, upgrade, log, ipc } from "@astrid-os/sdk";
import type { TestEvent } from "../gen/events.js";

@capsule
export class TestCapsule {
  counter = 0;

  /** Increment a counter and return the new value. */
  @tool("increment", { mutable: true })
  increment(_args: object): { counter: number } {
    this.counter = (this.counter + 1) >>> 0;
    log.info(`counter incremented to ${this.counter}`);
    return { counter: this.counter };
  }

  /** Return the current counter without modifying it. */
  @tool("get_counter")
  getCounter(_args: object): { counter: number } {
    return { counter: this.counter };
  }

  /** Publish a WIT-typed event on the IPC bus. */
  @tool("emit_event")
  emitEvent(_args: object): { published: boolean } {
    const event: TestEvent = {
      id: "evt-001",
      count: 1,
      label: "test",
      tags: ["demo"],
    };
    ipc.publishJson("test.v1.event.fired", event);
    return { published: true };
  }

  /** Pass-through interceptor for `test.v1.event` topic. */
  @interceptor("test.v1.event")
  handleEvent(_payload: unknown): { handled: boolean } {
    return { handled: true };
  }

  @install
  onInstall(): void {
    log.info("test-capsule installed");
  }

  @upgrade
  onUpgrade(prevVersion: string): void {
    log.info(`test-capsule upgraded from ${prevVersion}`);
  }
}
