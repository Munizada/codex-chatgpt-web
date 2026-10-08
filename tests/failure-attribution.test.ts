import { expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { attributeChatGptWebFailure } from "../src/adapters/chatgpt-web/failure-attribution";

const adapterFailure = (code: string) => new ChatGptWebAdapterError("test failure", {
  status: 502, errorType: "server_error", code, retryable: false,
});

test("explicit ChatGPT UI failures are evidence, not inferred infrastructure outages", () => {
  for (const code of ["rate_limit_exceeded", "chatgpt_session_expired", "chatgpt_subscription_unavailable", "upstream_server_error"]) {
    expect(attributeChatGptWebFailure(adapterFailure(code))).toEqual({
      origin: "chatgpt_ui_observed",
      evidence: "explicit_chatgpt_ui_signal",
      code,
    });
  }
});

test("local input validation is distinguished from ChatGPT service failures", () => {
  expect(attributeChatGptWebFailure(adapterFailure("context_length_exceeded"))).toEqual({
    origin: "local_policy_observed",
    evidence: "local_validation",
    code: "context_length_exceeded",
  });
});

test("Send timeout, model control mismatch and tool transport faults remain undetermined", () => {
  expect(attributeChatGptWebFailure(new Error("ChatGPT browser stage timed out: send")))
    .toEqual({ origin: "undetermined", evidence: "browser_stage_deadline", code: "browser_stage_timeout" });
  expect(attributeChatGptWebFailure(adapterFailure("chatgpt_model_control_unavailable")))
    .toEqual({ origin: "undetermined", evidence: "integration_or_transport", code: "chatgpt_model_control_unavailable" });
  expect(attributeChatGptWebFailure(adapterFailure("codex_tool_timeout")))
    .toEqual({ origin: "undetermined", evidence: "integration_or_transport", code: "codex_tool_timeout" });
  expect(attributeChatGptWebFailure(new Error("Unexpected browser DOM")))
    .toEqual({ origin: "undetermined", evidence: "unclassified_error", code: "unknown" });
});
