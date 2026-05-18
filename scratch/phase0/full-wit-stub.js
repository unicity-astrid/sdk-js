// Phase 0 task 4: prove ComponentizeJS works against the real astrid-capsule.wit.
//
// The world `capsule` requires four guest exports:
//   - astrid-hook-trigger(action, payload) -> capsule-result
//   - run()
//   - astrid-install()
//   - astrid-upgrade()
//
// WIT kebab-case becomes camelCase on the JS side.
// We import a couple of host functions just to confirm the binding shape
// holds at the full-surface scale.

import { log } from "astrid:capsule/sys@0.1.0";
import { ipcPublish } from "astrid:capsule/ipc@0.1.0";

export function astridHookTrigger(action, payload) {
  log({ tag: "info" }, `astrid-hook-trigger: ${action} (${payload.length} bytes)`);

  if (action === "tool_describe") {
    const data = JSON.stringify({
      tools: [
        {
          name: "stub_call",
          description: "Phase-0 stub tool that returns a static payload.",
          input_schema: { type: "object", properties: {} },
        },
      ],
      description: "Phase 0 toolchain validation stub capsule.",
    });
    return { action: "continue", data };
  }

  if (action === "tool_execute_stub_call") {
    let callId = "unknown";
    try {
      const req = JSON.parse(new TextDecoder().decode(new Uint8Array(payload)));
      callId = req.call_id ?? callId;
    } catch (_) {}

    const result = JSON.stringify({
      type: "tool_execute_result",
      call_id: callId,
      result: { call_id: callId, content: "stub_call: ok", is_error: false },
    });
    try {
      ipcPublish("tool.v1.execute.stub_call.result", result);
    } catch (e) {
      log({ tag: "error" }, `ipc-publish failed: ${e?.message ?? e}`);
    }
    return { action: "continue", data: undefined };
  }

  return { action: "deny", data: `unknown hook action: ${action}` };
}

export function run() {
  // Non-runnable stub: return immediately so the kernel doesn't wait.
}

export function astridInstall() {
  log({ tag: "info" }, "phase0-stub installed");
}

export function astridUpgrade() {
  log({ tag: "info" }, "phase0-stub upgraded");
}
