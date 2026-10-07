import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_EXEC_MAX_YIELD_MS,
  CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
  CHATGPT_WEB_RELIABILITY_PATCH_REVISION,
  CHATGPT_WEB_WRITE_STDIN_MAX_YIELD_MS,
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

test("explicit exec yields are capped below the MCP deadline across direct and namespaced routes", () => {
  expect(CHATGPT_WEB_EXEC_MAX_YIELD_MS).toBe(90_000);
  expect(chatGptTransportBoundToolArguments("exec_command", {
    cmd: "sleep 300",
    yield_time_ms: 300_000,
  })).toEqual({
    cmd: "sleep 300",
    yield_time_ms: CHATGPT_WEB_EXEC_MAX_YIELD_MS,
  });
  expect(chatGptTransportBoundToolArguments("mcp__codexLocalOps__exec_command", {
    cmd: "sleep 300",
    yield_time_ms: 120_000,
  })).toEqual({
    cmd: "sleep 300",
    yield_time_ms: CHATGPT_WEB_EXEC_MAX_YIELD_MS,
  });
  expect(chatGptTransportBoundToolArguments("mcp__codexLocalOps__exec_command", { cmd: "pwd" }))
    .toEqual({ cmd: "pwd", yield_time_ms: CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS });
});

test("write_stdin polling is capped below the MCP deadline across direct and namespaced routes", () => {
  expect(CHATGPT_WEB_WRITE_STDIN_MAX_YIELD_MS).toBe(90_000);
  expect(chatGptTransportBoundToolArguments("write_stdin", {
    session_id: 42,
    yield_time_ms: 300_000,
  })).toEqual({
    session_id: 42,
    yield_time_ms: CHATGPT_WEB_WRITE_STDIN_MAX_YIELD_MS,
  });
  expect(chatGptTransportBoundToolArguments("mcp__codexLocalOps__write_stdin", {
    session_id: 42,
    yield_time_ms: 120_000,
  })).toEqual({
    session_id: 42,
    yield_time_ms: CHATGPT_WEB_WRITE_STDIN_MAX_YIELD_MS,
  });
  const safe = { session_id: 42, yield_time_ms: 30_000 };
  expect(chatGptTransportBoundToolArguments("write_stdin", safe)).toBe(safe);
});

test("transport yield guard leaves unrelated tool arguments untouched", () => {
  const unrelated = { timeout_ms: 30_000 };
  expect(chatGptTransportBoundToolArguments("collaboration__wait_agent", unrelated)).toBe(unrelated);
});

test("long command-like MCP tools get bounded headroom below the two-minute tunnel", () => {
  const environment = {} as Parameters<typeof chatGptMcpInvocationTimeoutForTool>[0];
  expect(CHATGPT_WEB_RELIABILITY_PATCH_REVISION).toBe("v6.1.5-r8");
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBe(110_000);
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBeGreaterThan(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
  expect(CHATGPT_WEB_LONG_TOOL_INVOCATION_TIMEOUT_MS).toBeLessThan(120_000);

  for (const name of [
    "exec",
    "exec_command",
    "shell_command",
    "write_stdin",
    "mcp__codexLocalOps__local_shell_run",
    "mcp__agent_browser__agent_browser_open",
  ]) {
    expect(chatGptLongRunningToolName(name)).toBeTrue();
    expect(chatGptMcpInvocationTimeoutForTool(environment, name, 0)).toBe(110_000);
  }

  expect(chatGptLongRunningToolName("apply_patch")).toBeFalse();
  expect(chatGptMcpInvocationTimeoutForTool(environment, "apply_patch", 0)).toBe(90_000);
  expect(chatGptMcpInvocationTimeoutForTool({ ...environment, expiresAt: 42_000 }, "exec_command", 2_000)).toBe(40_000);
});
