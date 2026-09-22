# Custom patches for codex-chatgpt-web v5.0.8

Snapshot of the validated user-maintained fixes.

## Patch 1 — Bigger Context stability

- Supports adaptive multipart staging from 2–8 parts.
- Targets roughly 40k input tokens per physical stage.
- Preserves transaction ordering, SHA-256 integrity, duplicate-send protection and fail-closed ACK handling.
- Adds latest-assistant rebind recovery for staged and final responses.

Original merged fix:
`73b30f4667d41ac5490764b36335de88c138435d`

## Patch 2.1 — exec_command transport yield guard

Patch 2 originally defaulted `codex_exec` to `yield_time_ms=30000`, but a real diagnostic proved that generic `codex_tool_call` could bypass that route and still hit the hard 90-second MCP invocation deadline.

Patch 2.1 centralizes the transport guard:

- Any structured call whose final native tool is exactly `exec_command` receives `yield_time_ms: 30000` when omitted.
- Explicit `yield_time_ms` values are preserved.
- Covers dedicated `codex_exec`.
- Covers direct `codex_tool_call -> exec_command`.
- Covers structured gateway `codex_tool_call -> exec_command`.
- Covers raw gateway JavaScript calling `tools.exec_command(...)`.
- Keeps `CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS = 90000` unchanged.
- Leaves unrelated tools and `shell_command` behavior unchanged.
- Does not change the public MCP connector ABI.

Patch 2 merged fix:
`0835901f88ed6dd822b92a60cec68c2e9dd02159`

Patch 2.1 merged fix:
`954767efe09d22f83fbc575e54e07562f944b060`

## Validation

Patch 2.1 PR validation:
- actionlint: pass
- Linux `bun run verify`: pass
- Linux package / ABI / smoke: pass
- Windows `bun run verify`: pass
- Windows package / smoke: pass
- macOS `bun run verify`: pass
- macOS PR package reaches the known unsigned-PR `codesign` verification failure

Final main Windows artifact:
- workflow run: `35733772450`
- verify: pass
- package: pass
- smoke: pass
- archive/upload: pass
- artifact digest: `sha256:9fafb377a1ff8f00965b434235c8b826341fe85bf663a61cf5a45e59169b6cc6`

## Future upstream migration

Before porting these patches to a later upstream release:
1. Compare upstream implementation first.
2. Retire any local behavior that upstream already implements equivalently or better.
3. For Bigger Context, validate large real turns rather than blindly preserving the 2–8 planner.
4. For exec handling, ensure every route to native `exec_command` yields well before the MCP transport deadline.
5. Preserve caller-selected explicit yield intervals.
6. Run full verify, Windows package and Windows smoke.
