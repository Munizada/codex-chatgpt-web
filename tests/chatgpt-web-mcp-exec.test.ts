import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS,
  CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS,
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
