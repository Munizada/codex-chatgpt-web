import { expect, test } from "bun:test";
import { ChatGptMarkdownBuffer, type ChatGptMarkdownSegment } from "../src/adapters/chatgpt-web/markdown";

const paragraph = (key: string, text: string, streamable: boolean): ChatGptMarkdownSegment => ({
  key,
  tag: "p",
  html: `<p>${text}</p>`,
  text,
  streamable,
});

test("a later paragraph may repeat already-committed text without aliasing the old block", () => {
  const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);

  expect(buffer.observe([
    paragraph("first", "First paragraph.", true),
    paragraph("same-1", "Same paragraph.", true),
    paragraph("middle", "Middle paragraph.", false),
  ], 0)).toBe("First paragraph.\n\nSame paragraph.");
  expect(buffer.currentSnapshotIsConsistent()).toBeTrue();

  const delta = buffer.observe([
    paragraph("first", "First paragraph.", true),
    paragraph("same-1", "Same paragraph.", true),
    paragraph("middle", "Middle paragraph.", true),
    paragraph("same-2", "Same paragraph.", false),
  ], 1);

  expect(buffer.currentSnapshotIsConsistent()).toBeTrue();
  expect(delta).toBe("\n\nMiddle paragraph.");

  const final = buffer.finish();
  expect(final.markdown).toBe(
    "First paragraph.\n\nSame paragraph.\n\nMiddle paragraph.\n\nSame paragraph.",
  );
  expect(final.delta).toBe("\n\nSame paragraph.");
});
