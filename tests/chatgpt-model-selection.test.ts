import { expect, test } from "bun:test";
import { assertChatGptModelFamily, chatGptModelFamilyMatches, selectChatGptModelFamily } from "../src/adapters/chatgpt-web/model-selection";

test("model selection recognizes Latest in the launcher languages without accepting other model names", async () => {
  for (const [label, accepted] of [
    ["Latest", true], ["最新", true], ["최신", true], ["GPT-6", true],
    ["GPT-6 Sol", true], ["GPT-6 Pro", true], ["GPT-6 Astra Pro", true],
    ["GPT-5.6 Sol", false], ["GPT-7 Pro", false], ["Latest preview", false],
  ] as const) {
    const menu = { menu: {
      getByRole: (_role: string, options: { name: RegExp }) => ({
        count: async () => options.name.test(label) ? 1 : 0,
        getAttribute: async () => "true",
        waitFor: async () => { throw new Error("Requested family is absent"); },
      }),
      locator: () => ({ count: async () => 1, getAttribute: async () => "true" }),
    }, slider: { evaluate: async () => [] } } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
    const selection = selectChatGptModelFamily(menu, "6", async () => menu);
    if (accepted) expect(await selection).toBe(menu);
    else await expect(selection).rejects.toThrow("could not be selected and verified");
  }
});

test("family confirmation separates Latest staging from the actual Pro response", () => {
  expect(chatGptModelFamilyMatches(["5.6 High, 3 of 5."], "5.6", "high")).toBe(true);
  expect(chatGptModelFamilyMatches(["6 Instant, 1 of 5."], "6", "low")).toBe(true);
  expect(chatGptModelFamilyMatches(["GPT-6 Sol Medium, 2 of 5."], "6", "medium")).toBe(true);
  expect(chatGptModelFamilyMatches(["6 High, 3 of 5."], "6", "high")).toBe(true);
  expect(chatGptModelFamilyMatches(["6 Extra High, 4 of 5."], "6", "xhigh")).toBe(true);
  expect(chatGptModelFamilyMatches(["5.6 Extra High, 4 of 5."], "6", "xhigh")).toBe(false);
  expect(chatGptModelFamilyMatches(["GPT-6 Astra High, 3 of 5."], "6", "high")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Medium, 2 of 5."], "6", "high")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "max")).toBe(true);
  expect(chatGptModelFamilyMatches(["GPT-5.6 Sol Pro, 5 of 5."], "5.6", "max")).toBe(true);
  for (const descriptions of [[], ["Try Pro for more reasoning"], ["5.6 High, 3 of 5."], ["5.6 Pro, 5 of 5."],
    ["7 Pro, 5 of 5."], ["6 Sol Pro, 5 of 5."], ["6 Pro, 5 of 5.", "5.6 Pro, 5 of 5."], ["6 Pro for better answers"]]) {
    expect(chatGptModelFamilyMatches(descriptions, "6", "max")).toBe(false);
  }
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "5.6", "max")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "xhigh")).toBe(false);
});

test("active GPT-6 slider header works when the current ChatGPT picker has no model radio rows", async () => {
  for (const [announcement, family, effort, index] of [
    ["6 Instant", "6", "low", 0],
    ["GPT-6 Sol Medium", "6", "medium", 1],
    ["6 High", "6", "high", 2],
    ["6 Extra High", "6", "xhigh", 3],
    ["5.6 High", "5.6", "high", 2],
  ] as const) {
    const menu = {
      menu: {
        getByRole: () => ({ count: async () => 0 }),
        locator: () => ({ count: async () => 0 }),
      },
      slider: {
        evaluate: async () => [announcement],
        getAttribute: async (key: string) => ({
          "aria-valuemin": "0", "aria-valuemax": "4", "aria-valuenow": String(index),
        })[key],
      },
    } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
    expect(await selectChatGptModelFamily(menu, family, async () => menu)).toBe(menu);
    await expect(assertChatGptModelFamily(menu, family, effort, index)).resolves.toBeUndefined();
  }
});

test("active picker evidence blocks GPT-6 when browser still exposes GPT-5.6, even without a radio", async () => {
  const menu = {
    menu: {
      getByRole: () => ({ count: async () => 0 }),
      locator: () => ({ count: async () => 0 }),
    },
    slider: { evaluate: async () => ["5.6 High"] },
  } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
  await expect(selectChatGptModelFamily(menu, "6", async () => menu))
    .rejects.toThrow("ChatGPT model 6 could not be selected and verified");
});

test("active picker rejects conflicting family announcements without a radio", async () => {
  const menu = {
    menu: { getByRole: () => ({ count: async () => 0 }), locator: () => ({ count: async () => 0 }) },
    slider: { evaluate: async () => ["6 High", "5.6 High"] },
  } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
  await expect(selectChatGptModelFamily(menu, "6", async () => menu))
    .rejects.toThrow("ChatGPT model 6 could not be selected and verified");
});
