import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_EXEC_INVOCATION_TIMEOUT_MS,
  CHATGPT_WEB_EXEC_PATCH_REVISION,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
  chatGptMcpInvocationTimeoutForTool,
  chatGptTransportBoundToolArguments,
} from "../src/adapters/chatgpt-web/mcp-server";

test("exec_command defaults to a transport-safe yield before the MCP deadline", () => {
  expect(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS).toBe(30_000);
  expect(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS).toBeLessThan(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
  expect(chatGptTransportBoundToolArguments("exec_command", { cmd: "sleep 60" })).toEqual({
    cmd: "sleep 60",
    yield_time_ms: CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  });
});

test("exec_command preserves an explicit yield interval", () => {
  const explicit = { cmd: "sleep 60", yield_time_ms: 5_000 };
  expect(chatGptTransportBoundToolArguments("exec_command", explicit)).toBe(explicit);
});

test("transport yield guard leaves unrelated tools untouched", () => {
  const unrelated = { timeout_ms: 180_000 };
  expect(chatGptTransportBoundToolArguments("collaboration__wait_agent", unrelated)).toBe(unrelated);
});


test("Patch 2.2 keeps the ordinary MCP deadline but gives exec_command pre-yield headroom", () => {
  const environment = {} as Parameters<typeof chatGptMcpInvocationTimeoutForTool>[0];
  expect(CHATGPT_WEB_EXEC_PATCH_REVISION).toBe("v6-p2.2");
  expect(CHATGPT_WEB_EXEC_INVOCATION_TIMEOUT_MS).toBe(110_000);
  expect(CHATGPT_WEB_EXEC_INVOCATION_TIMEOUT_MS).toBeGreaterThan(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
  expect(CHATGPT_WEB_EXEC_INVOCATION_TIMEOUT_MS).toBeLessThan(120_000);
  expect(chatGptMcpInvocationTimeoutForTool(environment, "exec_command", 0))
    .toBe(CHATGPT_WEB_EXEC_INVOCATION_TIMEOUT_MS);
  expect(chatGptMcpInvocationTimeoutForTool(environment, "write_stdin", 0))
    .toBe(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
  expect(chatGptMcpInvocationTimeoutForTool({ ...environment, expiresAt: 42_000 }, "exec_command", 2_000))
    .toBe(40_000);
});
