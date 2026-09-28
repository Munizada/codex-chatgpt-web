import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
  CHATGPT_WEB_RELIABILITY_PATCH_REVISION,
  chatGptLongRunningToolName,
  chatGptMcpInvocationTimeoutForTool,
  chatGptTransportBoundToolArguments,
} from "../src/adapters/chatgpt-web/mcp-server";

test("exec_command defaults to a transport-safe 30s yield", () => {
  expect(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS).toBe(30_000);
  expect(chatGptTransportBoundToolArguments("exec_command", { cmd: "sleep 60" })).toEqual({
    cmd: "sleep 60",
    yield_time_ms: 30_000,
  });
});

test("exec_command preserves an explicit yield interval", () => {
  const explicit = { cmd: "sleep 60", yield_time_ms: 5_000 };
  expect(chatGptTransportBoundToolArguments("exec_command", explicit)).toBe(explicit);
});

test("transport yield guard leaves unrelated tool arguments untouched", () => {
  const unrelated = { timeout_ms: 30_000 };
  expect(chatGptTransportBoundToolArguments("collaboration__wait_agent", unrelated)).toBe(unrelated);
});

test("long command-like MCP tools get bounded headroom below the two-minute tunnel", () => {
  const environment = {} as Parameters<typeof chatGptMcpInvocationTimeoutForTool>[0];
  expect(CHATGPT_WEB_RELIABILITY_PATCH_REVISION).toBe("v6.1.3-r2");
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBe(110_000);
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBeGreaterThan(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBeLessThan(120_000);

  for (const name of [
    "exec",
    "exec_command",
    "shell_command",
    "write_stdin",
    "mcp__codexLocalOps__local_shell_run",
  ]) {
    expect(chatGptLongRunningToolName(name)).toBeTrue();
    expect(chatGptMcpInvocationTimeoutForTool(environment, name, 0)).toBe(110_000);
  }

  expect(chatGptLongRunningToolName("apply_patch")).toBeFalse();
  expect(chatGptMcpInvocationTimeoutForTool(environment, "apply_patch", 0)).toBe(90_000);
  expect(chatGptMcpInvocationTimeoutForTool({ ...environment, expiresAt: 42_000 }, "exec_command", 2_000)).toBe(40_000);
});
