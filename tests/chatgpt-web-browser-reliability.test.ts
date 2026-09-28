import { expect, test } from "bun:test";
import {
  CHATGPT_BROWSER_PAGE_REBIND_ACQUISITION_ATTEMPTS,
  CHATGPT_COMPACTION_RESPONSE_DOM_GRACE_MS,
  CHATGPT_RESPONSE_DOM_GRACE_MS,
  ChatGptTurnDomHealthTracker,
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

test("launcher rebind retries page acquisition before killing a live turn", () => {
  expect(CHATGPT_BROWSER_PAGE_REBIND_ACQUISITION_ATTEMPTS).toBe(2);
});
