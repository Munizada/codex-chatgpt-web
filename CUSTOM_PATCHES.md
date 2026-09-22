# Custom patches for codex-chatgpt-web v5.0.8

Snapshot of the user-maintained fixes validated on top of v5.0.8.

## Patch 1 — Bigger Context stability

Purpose: keep large ChatGPT Web turns reliable instead of sending ~60k+ token stages that frequently stalled during acknowledgement.

Key behavior:
- Supports 2–8 multipart parts.
- Targets roughly 40k input tokens per physical staging message.
- Example regression: ~138k input plans as multipart-4 instead of multipart-2.
- Compaction selects multipart before the legacy inline byte cap.
- Browser observation/rebind follows the latest assistant shell during staged acknowledgements and the final response.
- Existing transaction ordering, SHA-256 integrity, duplicate-send protection, and fail-closed checks remain intact.

Original merged fix commit:
- `73b30f4667d41ac5490764b36335de88c138435d`

## Patch 2 — Long Codex exec yield guard

Purpose: prevent a long native `exec_command` from reaching the hard 90-second MCP invocation deadline and retiring the entire turn binding.

Key behavior:
- Keeps `CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS = 90_000` unchanged.
- Adds `CHATGPT_WEB_EXEC_DEFAULT_YIELD_MS = 30_000`.
- When `codex_exec` targets native `exec_command` and the model omits `yield_time_ms`, the bridge injects `yield_time_ms: 30000`.
- Explicit model-provided `yield_time_ms` values are preserved.
- The `shell_command` fallback is unchanged.
- The public MCP tool description/ABI is unchanged, avoiding an unnecessary connector identity/hash change.
- Long-running native commands can yield a `session_id` and continue through `codex_write_stdin` before the MCP transport deadline.

Patch 2 merged commit:
- `0835901f88ed6dd822b92a60cec68c2e9dd02159`

## Validation

Combined snapshot validated with:
- GitHub Actions actionlint: pass
- Linux `bun run verify`: pass
- Linux package / ABI / smoke: pass
- macOS `bun run verify`: pass
- Windows `bun run verify`: pass
- Windows package: pass
- Windows smoke: pass
- Patched Windows artifact build: pass

The macOS PR packaging job can fail its strict `codesign` verification because GitHub PR builds intentionally skip signing; this is packaging environment behavior, not a source/test failure.

## Porting checklist for future upstream releases

1. Compare the new upstream implementation before applying either custom patch.
2. Do not duplicate Patch 1 if upstream already provides adaptive multipart staging and robust latest-assistant rebind behavior.
3. For Patch 2, check whether `codex_exec` already bounds/yields native command execution before the MCP transport deadline.
4. Preserve the relationship: command yield well below MCP invocation deadline, and MCP deadline below the external tunnel deadline.
5. Preserve explicit caller/model yield values.
6. Run the full `bun run verify` suite.
7. Build and smoke-test the Windows package.
8. Exercise a large Bigger Context turn and a command that runs longer than 30 seconds.
