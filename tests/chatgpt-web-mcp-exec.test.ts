import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
  chatGptExecYieldTimeMs,
  chatGptTransportBoundToolArguments,
} from "../src/adapters/chatgpt-web/mcp-server";

test("codex_exec defaults native command yielding before the MCP transport deadline", () => {
  expect(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS).toBe(30_000);
  expect(chatGptExecYieldTimeMs()).toBe(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS);
  expect(CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS).toBeLessThan(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS);
});

test("codex_exec preserves an explicit model-selected yield interval", () => {
  expect(chatGptExecYieldTimeMs(250)).toBe(250);
  expect(chatGptExecYieldTimeMs(5_000)).toBe(5_000);
  expect(chatGptExecYieldTimeMs(30_000)).toBe(30_000);
});


test("all structured exec_command routes receive the safe default yield when omitted", () => {
  expect(chatGptTransportBoundToolArguments("exec_command", { cmd: "sleep 60" })).toEqual({
    cmd: "sleep 60",
    yield_time_ms: CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  });
});

test("transport guard preserves explicit exec_command yield and leaves unrelated tools untouched", () => {
  const explicit = { cmd: "sleep 60", yield_time_ms: 5_000 };
  expect(chatGptTransportBoundToolArguments("exec_command", explicit)).toBe(explicit);
  const unrelated = { timeout_ms: 180_000 };
  expect(chatGptTransportBoundToolArguments("collaboration__wait_agent", unrelated)).toBe(unrelated);
});
