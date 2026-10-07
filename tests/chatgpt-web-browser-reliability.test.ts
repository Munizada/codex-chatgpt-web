import { expect, test } from "bun:test";
import {
  CHATGPT_BROWSER_PAGE_REBIND_ACQUISITION_ATTEMPTS,
  CHATGPT_OPERATIONAL_VIEWPORT_GRACE_MS,
  CHATGPT_REBIND_OPERATIONAL_VIEWPORT_GRACE_MS,
  CHATGPT_COMPACTION_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RUNNING_STALL_GRACE_MS,
  CHATGPT_QUIESCENT_STALL_GRACE_MS,
  ChatGptRunningStallTracker,
  ChatGptQuiescentStallTracker,
  ChatGptTurnDomHealthTracker,
  connectAfterClosingBrowserConnection,
  chatGptResponseDomGraceMs,
} from "../src/adapters/chatgpt-web/browser-worker";

test("a visibly running turn must still make observable progress", () => {
  expect(CHATGPT_RUNNING_STALL_GRACE_MS).toBe(10 * 60_000);
  const tracker = new ChatGptRunningStallTracker();
  const stalled = {
    running: true,
    currentText: "working",
    progressSignature: "reasoning: step 1",
    externalProgressLive: false,
  };
  expect(tracker.update(stalled, 0)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_RUNNING_STALL_GRACE_MS - 1)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_RUNNING_STALL_GRACE_MS)).toBeTrue();

  expect(tracker.update({ ...stalled, currentText: "working more" }, CHATGPT_RUNNING_STALL_GRACE_MS + 1)).toBeFalse();
  expect(tracker.update({ ...stalled, progressSignature: "reasoning: step 2" }, CHATGPT_RUNNING_STALL_GRACE_MS + 2)).toBeFalse();
  expect(tracker.update({ ...stalled, externalProgressLive: true }, CHATGPT_RUNNING_STALL_GRACE_MS * 2)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_RUNNING_STALL_GRACE_MS * 3)).toBeFalse();
  expect(tracker.update({ ...stalled, running: false }, CHATGPT_RUNNING_STALL_GRACE_MS * 4)).toBeFalse();
});

test("a quiescent incomplete turn must still make observable progress", () => {
  expect(CHATGPT_QUIESCENT_STALL_GRACE_MS).toBe(60_000);
  const tracker = new ChatGptQuiescentStallTracker();
  const stalled = {
    responsePresent: true,
    running: false,
    currentText: "",
    progressSignature: "status: waiting",
    completionActionVisible: false,
    externalProgressLive: false,
  };
  expect(tracker.update(stalled, 0)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_QUIESCENT_STALL_GRACE_MS - 1)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_QUIESCENT_STALL_GRACE_MS)).toBeTrue();

  expect(tracker.update({ ...stalled, progressSignature: "status: next" }, CHATGPT_QUIESCENT_STALL_GRACE_MS + 1)).toBeFalse();
  expect(tracker.update({ ...stalled, externalProgressLive: true }, CHATGPT_QUIESCENT_STALL_GRACE_MS * 2)).toBeFalse();
  expect(tracker.update(stalled, CHATGPT_QUIESCENT_STALL_GRACE_MS * 3)).toBeFalse();
  expect(tracker.update({ ...stalled, running: true }, CHATGPT_QUIESCENT_STALL_GRACE_MS * 4)).toBeFalse();
  expect(tracker.update({ ...stalled, completionActionVisible: true }, CHATGPT_QUIESCENT_STALL_GRACE_MS * 5)).toBeFalse();
  expect(tracker.update({ ...stalled, currentText: "answer" }, CHATGPT_QUIESCENT_STALL_GRACE_MS * 6)).toBeFalse();
  expect(tracker.update({ ...stalled, responsePresent: false }, CHATGPT_QUIESCENT_STALL_GRACE_MS * 7)).toBeFalse();
});

test("compaction gets a longer missing-response grace than ordinary turns", () => {
  expect(CHATGPT_RESPONSE_DOM_GRACE_MS).toBe(60_000);
  expect(CHATGPT_COMPACTION_RESPONSE_DOM_GRACE_MS).toBe(180_000);
  expect(chatGptResponseDomGraceMs(false)).toBe(60_000);
  expect(chatGptResponseDomGraceMs(true)).toBe(180_000);

  const tracker = new ChatGptTurnDomHealthTracker(chatGptResponseDomGraceMs(true));
  const absent = {
    responsePresent: false,
    running: false,
    currentText: "",
    completionActionVisible: false,
  };
  expect(tracker.update(absent, 0)).toBeUndefined();
  expect(tracker.update(absent, 60_001)).toBeUndefined();
  expect(tracker.update(absent, 179_999)).toBeUndefined();
  expect(tracker.update(absent, 180_000)).toContain("did not create a response DOM");
});

test("browser rebind closes the stale transport before connecting a replacement", async () => {
  const events: string[] = [];
  const replacement = await connectAfterClosingBrowserConnection(
    { close: async () => { events.push("close"); } },
    async () => {
      events.push("connect");
      return "replacement";
    },
  );
  expect(replacement).toBe("replacement");
  expect(events).toEqual(["close", "connect"]);
});

test("browser rebind never opens a replacement when stale transport cleanup fails", async () => {
  let connected = false;
  await expect(connectAfterClosingBrowserConnection(
    { close: async () => { throw new Error("close failed"); } },
    async () => {
      connected = true;
      return "replacement";
    },
  )).rejects.toThrow("close failed");
  expect(connected).toBeFalse();
});

test("launcher rebind retries page acquisition before killing a live turn", () => {
  expect(CHATGPT_BROWSER_PAGE_REBIND_ACQUISITION_ATTEMPTS).toBe(2);
});

test("rebind viewport recovery gets bounded extra headroom", () => {
  expect(CHATGPT_OPERATIONAL_VIEWPORT_GRACE_MS).toBe(10_000);
  expect(CHATGPT_REBIND_OPERATIONAL_VIEWPORT_GRACE_MS).toBe(30_000);
  expect(CHATGPT_REBIND_OPERATIONAL_VIEWPORT_GRACE_MS).toBeGreaterThan(CHATGPT_OPERATIONAL_VIEWPORT_GRACE_MS);
  expect(CHATGPT_REBIND_OPERATIONAL_VIEWPORT_GRACE_MS).toBeLessThan(60_000);
});
