# Reliability and failure-attribution audit — 2026-10-07

## Scope, inventory and evidence boundary

- Fork: `Munizada/codex-chatgpt-web`, audited starting at `75f501ffce5d84d43013ff249a69c7be22ba9e0d` (v6.1.5-r10).
- Upstream: `miuuyy/codex-chatgpt-web`, commit `92a356fac2292e3af5a97ab7ba634edd8d38621e`.
- Repository inventory: 293 tracked files in the fork versus 288 upstream; 34 fork additions/modifications, no upstream-only files in the inspected snapshot.
- Evidence: source and test contracts, GitHub Actions status, package/workflow definitions, and the four exported 2026-10-07 diagnostic JSONL files (which overlap and must not be counted as four independent histories).
- Review priority: Browser Send/response, launcher-daemon/helper IPC, MCP broker progress/fencing, recovery, packaging/update, diagnostics/provenance, security boundaries.
- The local packaging and smoke checks validate runtime construction and process startup; **they do not reproduce real ChatGPT service behavior, account-level rate limits, network failures, model output, or UI changes.**
- A static source review and green CI cannot prove zero defects. This is a living audit, with explicitly unresolved residual risks below.

## Historical incident reconstruction

| Revision / observed state | Concrete evidence | Interpretation |
| --- | --- | --- |
| Before r8 | 20-second ordinary Send deadlines and occasional browser viewport/closed-page failures | Local Send-stage deadline is observable; root service/DOM cause is not proven |
| v6.1.5 official | ~242k inline characters, ~72k estimated input tokens, Send timed out at ~20s; broker claim after retirement | First-evidence deadline too short for observed work; cannot claim underlying ChatGPT request definitely succeeded |
| r8 | A Send continued for ~47s and reached MCP execution; final quiescence reported `prepareRecovery=false` inside helper | Send-headroom improvement worked; out-of-process recovery capability was not forwarded |
| r9 | ~247k inline characters / ~73k estimated tokens, Send deadline at 60.012s | 60-second deadline inadequate for this observed large inline prompt; not proof that 180s guarantees acceptance |
| r10 | Large inline messages receive bounded 180s acceptance headroom; normal messages remain 60s | Time budget mitigation confirmed in unit/packaging tests, **not yet demonstrated against the failing real browser session** |

## Evidence-based audit findings and remediation

| Priority | Area | Finding | Remediation / state |
| --- | --- | --- | --- |
| P1 | IPC event callbacks | A synchronous `onHeartbeat`, `onTextDelta` or `onReasoningSummary` exception could escape the stdout event listener; an asynchronous `onSubmitted` rejection had no handler | r11: contain lifecycle callbacks, abort only the affected turn, preserve synchronous submission ordering, add fault-injection tests |
| P1 | MCP progress mirror | Missing `progress` capability was logged and tolerated even when causal progress was mandatory; a forwarding failure was logged without abort, risking a DOM-only completion decision | r11: reject missing required feature before dispatch and fail closed on mid-turn transport failure; test both cases |
| P1 | Failure provenance | Unavailable model controls were labeled `upstream_server_error`, wrongly implying an external fault despite possible selector/DOM/local-observer causes | r11: separate `chatgpt_model_control_unavailable` code; classify as `undetermined` |
| P1 | External error attribution | Generic Send timeout, unknown DOM state and browser/page observation faults cannot establish whether service, network or adapter is responsible | r11: structured `failure_attribution` log with `origin`, `evidence` and `code`; unknown remains **undetermined** |
| P2 | Recovery protocol | Duplicate recovery request frames could start two preparations before the first completed | r11: mark first request immediately; reject duplicates; regression test |
| P2 | Release/update identity | Fork revision r8/r9/r10 is separate from the application semver `6.1.5`; ordinary semver-based release/update checking cannot distinguish every fork patch | Not automatically resolved by CI; requires an explicit revision-aware update/release policy before promising automatic patch distribution |
| P1 | Actual cause of 247k Send stall | Longer deadline prevents *premature timeout at 60s* but does not prove why ChatGPT did not expose acceptance evidence | Still unresolved: capture non-sensitive request/DOM timing, correlate with service/UI evidence, compare large inline with staged delivery and local network |
| P2 | CI coverage | r10 reliability workflow completed successfully on the final main SHA; main CI run for the same SHA was cancelled while sequential commits were made, although the identical test tree passed on the PR | PR checks required for r11; final main SHA should be checked independently; cancellation is not a test pass |

## Safety and operational boundaries inspected

- The launcher control server binds to `127.0.0.1`, uses a random bearer token and constant-time matching; these are appropriate baseline controls, not a full penetration-test result.
- The fork updater points to `Munizada/codex-chatgpt-web` and validates HTTPS release asset URLs and checksums; don't infer that its version-selection behavior can detect r-revisions.
- The runtime installer validates manifest paths and bundle file hashes; deeper traversal/symlink/rollback stress testing remains valuable.
- Automatic native tool approval is disabled by default in launcher state; user selection and external MCP tool permissions still require runtime enforcement review.
- CI runs typechecks, root and launcher dependency audits, tests, packaging and smoke checks; it does not exercise authenticated ChatGPT Web end-to-end.

## Evidence and confidence levels

- **Proven local defect:** a reachable deterministic code path violates its own contract (e.g., unguarded callback, omitted mandatory progress mirror).
- **Observed external UI signal:** a ChatGPT-rendered alert or error, such as rate limit or session expiry. This proves the UI reported the condition, **not which backend component caused it**.
- **Local validation:** a deterministic rejection based on input limits or the adapter's own policy.
- **Undetermined:** a deadline, missing response, DOM mismatch, transport error or generic exception without direct causal evidence. These must never be presented as confirmed OpenAI server outages.

## Follow-up checks before any claim of near-100% stability

1. Verify r11 in CI (Linux/macOS/Windows, both dependency audits, tests, package and Windows smoke) and validate the final branch/main SHA.
2. Exercise fault-injection scenarios: helper process killed during active MCP tool, delayed/corrupted IPC frame, socket progress loss, late recovery ACK, duplicate submit evidence, and concurrent cancellation/completion.
3. Run real-browser controlled tests with a test account and consent: large inline prompt, multipart receipt, intermittent connectivity, ChatGPT UI recovery, and post-tool quiescence. Local CI cannot substitute for these.
4. Capture minimally necessary privacy-preserving telemetry including stage, event sequence, deadlines, helper and daemon revision, submit-evidence type and explicit site error codes; do not log prompts, credentials or tool arguments.
5. Decide how the fork's patch revision is exposed and updated independently of upstream semver; ensure versioned downloads cannot silently roll back reliability fixes.
6. Re-run comparison against every new upstream release, and review changes to Electron/Chromium/Playwright, MCP SDK, token budgets and frontend selector contracts.

## Completion criterion

This document does **not** certify the entire repository as defect-free. r11 closes the concrete local IPC and attribution issues above subject to passing tests. Unknown browser/service behavior, release-channel revision identity and untested adverse scenarios remain explicitly tracked.
