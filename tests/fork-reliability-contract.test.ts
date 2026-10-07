import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS,
  browserStageTimeouts,
  chatGptCheckpointStallRecoverySafe,
  chatGptExternalProgressSuppressesDomHealth,
  chatGptExternalToolCallsVetoCompletion,
  chatGptNewTurnIdentity,
  chatGptSubmissionEvidence,
} from "../src/adapters/chatgpt-web/browser-worker";
import {
  formatChatGptWebMultipartAcknowledgementRecovery,
  formatChatGptWebMultipartStage,
} from "../src/adapters/chatgpt-web/prompt";

test("accepted user identity disambiguates a transient duplicate assistant shell", () => {
  expect(chatGptNewTurnIdentity(
    [],
    ["group:assistant:activity-shell", "group:assistant:submitted"],
    "group:assistant:submitted",
  )).toBe("group:assistant:submitted");
  expect(() => chatGptNewTurnIdentity(
    [],
    ["group:assistant:activity-shell", "group:assistant:submitted"],
    "group:assistant:other",
  )).toThrow("2 new conversation turns");
});

test("active generation proves Send before duplicate assistant identities are inspected", () => {
  expect(chatGptSubmissionEvidence({
    initialTurnIdentities: ["group:user:old", "group:assistant:old"],
    userIdentities: ["group:user:old"],
    responseIdentities: [
      "group:assistant:old",
      "group:assistant:activity-shell",
      "group:assistant:submitted",
    ],
    generationRunning: true,
  })).toBe("generation_running");
});

test("stale unresolved MCP activity stops vetoing browser completion", () => {
  const snapshot = {
    revision: 2,
    lastToolBatchRevision: 2,
    activeToolCalls: 1,
    lastProgressAt: 1_000,
  };
  expect(chatGptExternalToolCallsVetoCompletion(snapshot, 1_001)).toBeTrue();
  expect(chatGptExternalProgressSuppressesDomHealth(
    snapshot,
    1_000 + CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS,
  )).toBeFalse();
  expect(chatGptExternalToolCallsVetoCompletion(
    snapshot,
    1_000 + CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS,
  )).toBeFalse();
});

test("Luna retries an empty stalled final answer but never a partially emitted checkpoint answer", () => {
  expect(chatGptCheckpointStallRecoverySafe(undefined, 42)).toBeTrue();
  expect(chatGptCheckpointStallRecoverySafe(false, 42)).toBeTrue();
  expect(chatGptCheckpointStallRecoverySafe(true, 0)).toBeTrue();
  expect(chatGptCheckpointStallRecoverySafe(true, 1)).toBeFalse();
});

test("multipart receipt waits preserve first-stage headroom but recover later stalls quickly", () => {
  expect(browserStageTimeouts.multipartInitialStageAcknowledgement).toBe(180_000);
  expect(browserStageTimeouts.multipartStageAcknowledgement).toBe(60_000);
  expect(browserStageTimeouts.multipartStageRecoveryAcknowledgement).toBe(20_000);
});

test("multipart acknowledgement recovery carries only the transaction receipt", () => {
  const transactionId = "ctx_0123456789abcdef0123456789abcdef";
  const payload = JSON.stringify({ secret_marker: "DO_NOT_REPEAT_STAGE_PAYLOAD" });
  const stage = formatChatGptWebMultipartStage(payload, transactionId, 3, 6);
  const recovery = formatChatGptWebMultipartAcknowledgementRecovery(stage);
  expect(recovery).toContain(stage.acknowledgement);
  expect(recovery).toContain("already submitted and is already present in this conversation");
  expect(recovery).not.toContain(payload);
  expect(recovery).not.toContain("DO_NOT_REPEAT_STAGE_PAYLOAD");
});

test("fork-only recovery paths remain wired on top of the 6.1.5 browser worker", () => {
  const worker = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
  const adapter = readFileSync("src/adapters/chatgpt-web/index.ts", "utf8");
  const helperClient = readFileSync("src/adapters/chatgpt-web/launcher-helper-client.ts", "utf8");
  const helperMain = readFileSync("src/adapters/chatgpt-web/browser-helper-main.ts", "utf8");

  expect(worker).toContain("prepareRecovery?:");
  expect(worker).toContain("generationBusyVisible");
  expect(worker).toContain("answerNowControl.press");
  expect(worker).toContain("same-conversation stall recovery");
  expect(worker).toContain("quiescent recovery decision");
  expect(worker).not.toContain("|| emittedAnswerChars > 0) return false");
  expect(worker).toContain("Preserve the running-stall timer across a transport-only rebind");
  expect(worker).toContain("Preserve the quiescent-stall timer across a transport-only rebind");
  expect(worker).toContain("ack_recovery_acknowledgement");
  expect(worker).toContain("submittedUserTurnIdentity");
  expect(worker).toContain("reused proven staging model selection");
  expect(worker).toContain("multipartInitialStageAcknowledgement");
  expect(worker).toContain("acknowledgementTimeoutMs = index === 0");
  expect(worker).toContain("multipartStageRecoveryAcknowledgement");
  expect(worker).toContain('error.code === "multipart_protocol_violation"');
  expect(worker).toContain(
    "chatGptExternalProgressSuppressesDomHealth(rebindProgressSnapshot, Date.now())",
  );
  expect(worker).toContain("progressClock?: Pick<ChatGptTurnProgressReader");
  expect(adapter).toContain("stalledTurnRecoveryRequest");
  expect(adapter).toContain("do not repeat that text; continue from exactly where it stopped");
  expect(adapter).toContain("prepareRecovery: () => prepareWith");
  expect(adapter).not.toContain("!parsed._compactionRequest && !captureLunaCheckpoint");
  expect(worker).toContain("checkpointRecoverySafe");
  expect(worker).toContain("chatGptSendAcceptanceTimeoutMs");
  expect(worker).toContain("CHATGPT_LARGE_INLINE_SEND_CHAR_THRESHOLD");
  expect(worker).toContain("CHATGPT_LARGE_INLINE_SEND_TOKEN_THRESHOLD");
  expect(worker).toContain("send acceptance budget");
  // The launcher executes browser turns out of process. A recovery callback that exists only in
  // the daemon is dead code unless the helper negotiates and requests it explicitly.
  expect(helperClient).toContain('this.helperFeatures.has("stall-recovery-prompt")');
  expect(helperClient).toContain("recoveryAvailable: true");
  expect(helperClient).toContain('event: "recovery_prepare_requested"');
  expect(helperClient).toContain('type: "recovery_prepared_ack"');
  expect(helperMain).toContain("recoveryAvailable?: boolean");
  expect(helperMain).toContain("prepareRecovery:");
  expect(helperMain).toContain('event: "recovery_prepare_requested"');
  expect(helperMain).toContain('message.type === "recovery_prepared_ack"');
  expect(helperMain).toContain('"stall-recovery-prompt"');
});
