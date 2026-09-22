import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
  chatGptExecYieldTimeMs,
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
