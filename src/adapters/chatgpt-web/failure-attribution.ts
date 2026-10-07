import { ChatGptWebAdapterError } from "./adapter-error";

/**
 * Evidence provenance is intentionally narrower than fault ownership.
 *
 * A ChatGPT UI alert proves what the browser displayed, not that OpenAI infrastructure caused it.
 * An unconfirmed Send or Playwright timeout proves neither a remote outage nor a local defect.
 */
export type ChatGptFailureEvidenceSource = "integration_verified" | "chatgpt_ui_observed" | "unattributed";

export interface ChatGptFailureEvidence {
  source: ChatGptFailureEvidenceSource;
  evidenceKind: string;
  code?: string;
}

const CHATGPT_UI_ERROR_CODES = new Set([
  "rate_limit_exceeded",
  "chatgpt_session_expired",
  "chatgpt_subscription_unavailable",
  "upstream_server_error",
]);

export function classifyChatGptFailureEvidence(error: unknown): ChatGptFailureEvidence {
  if (!(error instanceof ChatGptWebAdapterError)) {
    return { source: "unattributed", evidenceKind: "unstructured_exception" };
  }
  if (error.code === "prompt_attachment_integrity") {
    return { source: "integration_verified", evidenceKind: "attached_prompt_integrity_mismatch", code: error.code };
  }
  if (CHATGPT_UI_ERROR_CODES.has(error.code)) {
    return { source: "chatgpt_ui_observed", evidenceKind: "explicit_chatgpt_ui_signal", code: error.code };
  }
  return { source: "unattributed", evidenceKind: "adapter_error_without_causal_proof", code: error.code };
}
