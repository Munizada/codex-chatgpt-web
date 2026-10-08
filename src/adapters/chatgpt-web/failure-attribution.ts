import { ChatGptWebAdapterError } from "./adapter-error";

/**
 * Evidence-based failure domain. A browser deadline is an observation failure, not proof of
 * an OpenAI service outage. A visible ChatGPT UI signal is evidence of what the UI showed,
 * not a verified diagnosis of its backend.
 */
export interface ChatGptWebFailureAttribution {
  domain: "observed_chatgpt_ui" | "local_control" | "undetermined";
  evidence: string;
  confidence: "observed" | "unknown";
}

export class ChatGptBrowserStageTimeoutError extends Error {
  readonly stage: string;
  readonly timeoutMs: number;

  constructor(stage: string, timeoutMs: number) {
    super(`ChatGPT browser stage timed out: ${stage}`);
    this.name = "ChatGptBrowserStageTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export function attributeChatGptWebFailure(error: unknown): ChatGptWebFailureAttribution {
  if (error instanceof ChatGptBrowserStageTimeoutError) {
    return {
      domain: "undetermined",
      evidence: `browser_stage_deadline:${error.stage}`,
      confidence: "unknown",
    };
  }
  if (error instanceof ChatGptWebAdapterError) {
    if (error.code === "chatgpt_sign_in_required" || error.code === "chatgpt_stopped_thinking") {
      return {
        domain: "observed_chatgpt_ui",
        evidence: error.code,
        confidence: "observed",
      };
    }
    if (error.code === "client_cancelled") {
      return {
        domain: "local_control",
        evidence: error.code,
        confidence: "observed",
      };
    }
  }
  // Generic Playwright, network, parsing and connector errors are ambiguous without corroboration.
  // Do not blame the external service on the basis of a message string or an HTTP status alone.
  return { domain: "undetermined", evidence: "insufficient_origin_evidence", confidence: "unknown" };
}
