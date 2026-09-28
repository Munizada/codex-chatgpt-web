import { expect, test } from "bun:test";
import {
  CHATGPT_BROWSER_PAGE_REBIND_ACQUISITION_ATTEMPTS,
  CHATGPT_OPERATIONAL_VIEWPORT_GRACE_MS,
  CHATGPT_REBIND_OPERATIONAL_VIEWPORT_GRACE_MS,
  CHATGPT_COMPACTION_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RUNNING_STALL_POST_RECOVERY_GRACE_MS,
  CHATGPT_RUNNING_STALL_RECOVERY_MS,
  ChatGptRunningStallTracker,
  ChatGptTurnDomHealthTracker,
  connectAfterClosingBrowserConnection,
  chatGptResponseDomGraceMs,
} from "../src/adapters/chatgpt-web/browser-worker";

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

test("running turns recover once after prolonged silence and then fail closed", () => {
  expect(CHATGPT_RUNNING_STALL_RECOVERY_MS).toBe(15 * 60_000);
  expect(CHATGPT_RUNNING_STALL_POST_RECOVERY_GRACE_MS).toBe(5 * 60_000);

  const tracker = new ChatGptRunningStallTracker();
  expect(tracker.update({ running: true, progressRevision: 7 }, 0)).toBeUndefined();
  expect(tracker.update({ running: true, progressRevision: 7 }, CHATGPT_RUNNING_STALL_RECOVERY_MS - 1))
    .toBeUndefined();
  expect(tracker.update({ running: true, progressRevision: 7 }, CHATGPT_RUNNING_STALL_RECOVERY_MS))
    .toBe("recover");

  tracker.markRecovered(CHATGPT_RUNNING_STALL_RECOVERY_MS);
  expect(tracker.update({
    running: true,
    progressRevision: 7,
  }, CHATGPT_RUNNING_STALL_RECOVERY_MS + CHATGPT_RUNNING_STALL_POST_RECOVERY_GRACE_MS - 1))
    .toBeUndefined();
  expect(tracker.update({
    running: true,
    progressRevision: 7,
  }, CHATGPT_RUNNING_STALL_RECOVERY_MS + CHATGPT_RUNNING_STALL_POST_RECOVERY_GRACE_MS))
    .toBe("fail");
});

test("real model or tool progress resets the running-stall watchdog", () => {
  const tracker = new ChatGptRunningStallTracker();
  expect(tracker.update({ running: true, progressRevision: 2 }, 0)).toBeUndefined();
  expect(tracker.update({ running: true, progressRevision: 2 }, CHATGPT_RUNNING_STALL_RECOVERY_MS))
    .toBe("recover");
  tracker.markRecovered(CHATGPT_RUNNING_STALL_RECOVERY_MS);

  const progressedAt = CHATGPT_RUNNING_STALL_RECOVERY_MS + 1_000;
  expect(tracker.update({ running: true, progressRevision: 3 }, progressedAt)).toBeUndefined();
  expect(tracker.update({
    running: true,
    progressRevision: 3,
  }, progressedAt + CHATGPT_RUNNING_STALL_RECOVERY_MS - 1)).toBeUndefined();
  expect(tracker.update({
    running: true,
    progressRevision: 3,
  }, progressedAt + CHATGPT_RUNNING_STALL_RECOVERY_MS)).toBe("recover");

  expect(tracker.update({ running: false, progressRevision: 3 }, progressedAt + CHATGPT_RUNNING_STALL_RECOVERY_MS))
    .toBeUndefined();
  expect(tracker.update({ running: true, progressRevision: 3 }, progressedAt + CHATGPT_RUNNING_STALL_RECOVERY_MS + 1))
    .toBeUndefined();
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
