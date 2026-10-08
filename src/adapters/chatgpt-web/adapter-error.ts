export interface ChatGptWebAdapterErrorOptions {
  status: number;
  errorType: string;
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export class ChatGptWebAdapterError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: ChatGptWebAdapterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChatGptWebAdapterError";
    this.status = options.status;
    this.errorType = options.errorType;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

/**
 * Attribution is evidence-aware, not a claim about the ultimate operator at fault.
 * A ChatGPT UI error is observable upstream evidence, but it does not establish whether the
 * service, network, account, extension, or our browser automation caused the condition.
 */
export type ChatGptWebFailureOrigin =
  | "chatgpt_surface_observed"
  | "bridge_contract"
  | "client_cancelled"
  | "undetermined";

export function chatGptWebFailureAttribution(error: unknown): {
  origin: ChatGptWebFailureOrigin;
  evidence: string;
} {
  if (error instanceof ChatGptWebAdapterError) {
    if (error.code === "client_cancelled") {
      return { origin: "client_cancelled", evidence: "explicit turn cancellation" };
    }
    if ([
      "upstream_server_error",
      "chatgpt_session_expired",
      "chatgpt_subscription_unavailable",
      "chatgpt_stopped_thinking",
      "chatgpt_effort_locked",
    ].includes(error.code)) {
      return { origin: "chatgpt_surface_observed", evidence: "recognized ChatGPT interface state" };
    }
  }
  // A known incompatible local helper is a bridge contract violation, not an OpenAI outage.
  if (error instanceof Error && /^Launcher browser helper does not support /.test(error.message)) {
    return { origin: "bridge_contract", evidence: "local helper capability mismatch" };
  }
  // A Send timeout only shows that first-evidence observation exhausted its budget. It does
  // not establish whether a request reached the service or why the signal was delayed.
  return { origin: "undetermined", evidence: "insufficient evidence to assign root cause" };
}

export function chatGptToolTimeoutError(tool: string, timeoutMs: number): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `Codex tool ${tool} did not return a result within ${timeoutMs / 1_000} seconds. `
    + "The turn was stopped. Check whether the command is still running or waiting for approval before retrying.",
    { status: 504, errorType: "server_error", code: "codex_tool_timeout", retryable: false },
  );
}

export function chatGptResponseIncompleteError(message: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 502, errorType: "server_error", code: "chatgpt_response_incomplete", retryable: false,
  });
}

// Only the compaction owner may signal this after the broker accepts its one-shot handoff.
// It cancels browser observation, while the accepted summary remains the native result.
export class ChatGptCompactionHandoffAccepted extends DOMException {
  constructor() {
    super("Structured compaction handoff accepted", "AbortError");
  }
}

export function chatGptBrowserTabClosedError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The ChatGPT browser tab was closed, so the Codex turn was cancelled.",
    {
      status: 499,
      errorType: "client_closed_request",
      code: "client_cancelled",
      retryable: false,
    },
  );
}

export function chatGptTurnSupersededError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "A newer Codex instruction superseded this ChatGPT response.",
    { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false },
  );
}

export function chatGptStoppedThinkingError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "ChatGPT displayed 'Stopped thinking' and could not continue this response. "
    + "A ChatGPT Web usage limit may have been reached. Check the ChatGPT tab for the exact reason before retrying.",
    {
      status: 502,
      errorType: "server_error",
      code: "chatgpt_stopped_thinking",
      retryable: false,
    },
  );
}

export function chatGptRetainedConversationUnavailableError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The retained ChatGPT conversation is no longer available.",
    {
      status: 409,
      errorType: "invalid_request_error",
      code: "compaction_source_unavailable",
      retryable: false,
    },
  );
}
