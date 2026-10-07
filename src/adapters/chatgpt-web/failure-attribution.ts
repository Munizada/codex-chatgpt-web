import { ChatGptWebAdapterError } from "./adapter-error";

/**
 * Evidence-based attribution, not an assertion that ChatGPT/OpenAI caused the failure.
 * In particular, a deadline after pressing Send does not reveal whether the service,
 * network, browser DOM, or our own observer lost the acknowledgement.
 */
export interface ChatGptWebFailureAttribution {
  origin: "chatgpt_ui_observed" | "local_policy_observed" | "undetermined";
  evidence:
    | "explicit_chatgpt_ui_signal"
    | "local_validation"
    | "browser_stage_deadline"
    | "integration_or_transport"
    | "unclassified_error";
  code: string;
}

const explicitChatGptUiSignals = new Set([
  "rate_limit_exceeded",
  "chatgpt_session_expired",
  "chatgpt_subscription_unavailable",
  "chatgpt_sign_in_required",
  "upstream_server_error",
  "chatgpt_stopped_thinking",
]);

const localValidationCodes = new Set([
  "context_length_exceeded",
  "too_many_attachments",
  "chatgpt_effort_locked",
  "manual_multipart_unsupported",
]);

export function attributeChatGptWebFailure(error: unknown): ChatGptWebFailureAttribution {
  if (error instanceof ChatGptWebAdapterError) {
    if (explicitChatGptUiSignals.has(error.code)) {
      return { origin: "chatgpt_ui_observed", evidence: "explicit_chatgpt_ui_signal", code: error.code };
    }
    if (localValidationCodes.has(error.code)) {
      return { origin: "local_policy_observed", evidence: "local_validation", code: error.code };
    }
    return { origin: "undetermined", evidence: "integration_or_transport", code: error.code };
  }
  if (error instanceof Error && /^ChatGPT browser stage timed out: /.test(error.message)) {
    return { origin: "undetermined", evidence: "browser_stage_deadline", code: "browser_stage_timeout" };
  }
  return {
    origin: "undetermined",
    evidence: "unclassified_error",
    code: error instanceof DOMException && error.name === "AbortError" ? "abort" : "unknown",
  };
}
