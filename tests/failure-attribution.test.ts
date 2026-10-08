import { expect, test } from "bun:test";
import { ChatGptWebAdapterError, chatGptWebFailureAttribution } from "../src/adapters/chatgpt-web/adapter-error";
import { ChatGptWebTurnRetryPolicy, MAX_CHATGPT_WEB_TURN_RETRIES } from "../src/adapters/chatgpt-web/retry-policy";

function error(code: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError("synthetic failure", {
    status: 502, code, errorType: "server_error", retryable: true,
  });
}

test("failure attribution requires actual evidence rather than an HTTP-like status or timeout", () => {
  for (const ambiguous of [
    error("context_length_exceeded"),
    error("codex_tool_timeout"),
    new Error("ChatGPT browser stage timed out: send"),
    new Error("Unknown browser error"),
  ]) {
    expect(chatGptWebFailureAttribution(ambiguous).origin).toBe("undetermined");
  }

  for (const code of [
    "upstream_server_error",
    "chatgpt_session_expired",
    "chatgpt_subscription_unavailable",
    "chatgpt_stopped_thinking",
    "chatgpt_effort_locked",
  ]) {
    expect(chatGptWebFailureAttribution(error(code)).origin).toBe("chatgpt_surface_observed");
  }

  expect(chatGptWebFailureAttribution(new Error(
    "Launcher browser helper does not support same-conversation stall recovery",
  )).origin).toBe("bridge_contract");
  expect(chatGptWebFailureAttribution(error("client_cancelled")).origin).toBe("client_cancelled");
});

test("retry exhaustion does not imply an OpenAI outage without evidence", () => {
  const policy = new ChatGptWebTurnRetryPolicy();
  const failure = error("context_length_exceeded");
  let last = failure;
  for (let i = 0; i <= MAX_CHATGPT_WEB_TURN_RETRIES; i++) {
    last = policy.recordRetryableFailure("turn-1", failure, i + 1);
  }
  expect(last.retryable).toBe(false);
  expect(last.message).toContain("bridge defect from an external condition");
  expect(last.message).not.toContain("ChatGPT remained unavailable");
  policy.clear("turn-1");
  expect(policy.exhaustedError("turn-1")).toBeUndefined();
});
