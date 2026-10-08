import { expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import type { CompiledChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";

type PreparedRecovery = CompiledChatGptWebPrompt & { release: () => void };
import { ChatGptBrowserStageTimeoutError, attributeChatGptWebFailure } from "../src/adapters/chatgpt-web/failure-attribution";
import {
  CHATGPT_STALL_RECOVERY_PREPARATION_TIMEOUT_MS,
  ChatGptBrowserWorker,
  prepareChatGptStallRecoveryWithLateRelease,
} from "../src/adapters/chatgpt-web/browser-worker";

test("browser deadlines are not falsely attributed to OpenAI", () => {
  const timeout = new ChatGptBrowserStageTimeoutError("send", 180_000);
  expect(timeout.message).toBe("ChatGPT browser stage timed out: send");
  expect(timeout.timeoutMs).toBe(180_000);
  expect(attributeChatGptWebFailure(timeout)).toEqual({
    domain: "undetermined",
    evidence: "browser_stage_deadline:send",
    confidence: "unknown",
  });
  expect(attributeChatGptWebFailure(new Error("HTTP 502 from ChatGPT"))).toEqual({
    domain: "undetermined",
    evidence: "insufficient_origin_evidence",
    confidence: "unknown",
  });
  expect(attributeChatGptWebFailure(new TypeError("DOM snapshot failed")).domain).toBe("undetermined");
});

test("only direct UI evidence is classified as an observed ChatGPT UI failure", () => {
  const directUi = (code: string) => new ChatGptWebAdapterError(code, {
    status: 502, errorType: "server_error", code, retryable: false,
  });
  expect(attributeChatGptWebFailure(directUi("chatgpt_stopped_thinking"))).toEqual({
    domain: "observed_chatgpt_ui",
    evidence: "chatgpt_stopped_thinking",
    confidence: "observed",
  });
  expect(attributeChatGptWebFailure(directUi("unknown_remote_timeout")).domain).toBe("undetermined");
  expect(attributeChatGptWebFailure(directUi("client_cancelled")).domain).toBe("local_control");
});

test("late stall-recovery preparation releases its lease rather than contaminating another turn", async () => {
  let complete!: (prepared: PreparedRecovery) => void;
  let releases = 0;
  const controller = new AbortController();
  const pending = prepareChatGptStallRecoveryWithLateRelease(
    () => new Promise<PreparedRecovery>(resolve => { complete = resolve; }),
    controller.signal,
  );
  controller.abort();
  complete({ text: "continue", images: [], release: () => { releases++; } });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(releases).toBe(1);

  const successful = await prepareChatGptStallRecoveryWithLateRelease(
    async () => ({ text: "valid", images: [], release: () => { releases++; } }),
    new AbortController().signal,
  );
  expect(successful.text).toBe("valid");
  successful.release();
  expect(releases).toBe(2);
});

test("a missing stall-recovery IPC acknowledgement has a finite deadline", async () => {
  expect(CHATGPT_STALL_RECOVERY_PREPARATION_TIMEOUT_MS).toBe(60_000);
  const runStage = (ChatGptBrowserWorker.prototype as unknown as {
    runStage<T>(
      traceId: string,
      stage: string,
      timeoutMs: number,
      action: (signal: AbortSignal) => Promise<T>,
    ): Promise<T>;
  }).runStage;

  let releaseLate!: (prompt: PreparedRecovery) => void;
  let lateReleases = 0;
  const stage = runStage.call(
    {},
    "audit_recovery",
    "stall_recovery_prepare",
    10,
    signal => prepareChatGptStallRecoveryWithLateRelease(
      () => new Promise<PreparedRecovery>(resolve => { releaseLate = resolve; }),
      signal,
    ),
  );
  await expect(stage).rejects.toMatchObject({
    message: "ChatGPT browser stage timed out: stall_recovery_prepare",
  });
  releaseLate({ text: "late", images: [], release: () => { lateReleases++; } });
  await Promise.resolve();
  await Promise.resolve();
  expect(lateReleases).toBe(1);
});
