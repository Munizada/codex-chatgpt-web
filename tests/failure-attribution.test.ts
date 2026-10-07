import { expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { classifyChatGptFailureEvidence } from "../src/adapters/chatgpt-web/failure-attribution";

function failure(code: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError("A failure happened", {
    status: 502, errorType: "server_error", code, retryable: false,
  });
}

test("site-observed errors are evidence of a UI signal, not confirmed OpenAI infrastructure fault", () => {
  for (const code of [
    "rate_limit_exceeded",
    "chatgpt_session_expired",
    "chatgpt_subscription_unavailable",
    "upstream_server_error",
  ]) {
    expect(classifyChatGptFailureEvidence(failure(code))).toEqual({
      source: "chatgpt_ui_observed",
      evidenceKind: "explicit_chatgpt_ui_signal",
      code,
    });
  }
});

test("failed prompt attachment has verified integration-local evidence", () => {
  expect(classifyChatGptFailureEvidence(failure("prompt_attachment_integrity"))).toEqual({
    source: "integration_verified",
    evidenceKind: "attached_prompt_integrity_mismatch",
    code: "prompt_attachment_integrity",
  });
});

test("timeouts and ambiguous Send cannot be called an OpenAI outage", () => {
  expect(classifyChatGptFailureEvidence(new Error("ChatGPT browser stage timed out: send")))
    .toEqual({ source: "unattributed", evidenceKind: "unstructured_exception" });
  for (const code of [
    "chatgpt_submission_ambiguous",
    "chatgpt_submitted_turn_failed",
    "chatgpt_ui_controls_unverified",
    "connector_not_found",
  ]) {
    expect(classifyChatGptFailureEvidence(failure(code))).toEqual({
      source: "unattributed",
      evidenceKind: "adapter_error_without_causal_proof",
      code,
    });
  }
});
