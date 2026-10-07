# Codex Web GPT — reliability and failure-attribution audit (2026-10-07)

## Scope and assurance limits

This audit examines the `Munizada/codex-chatgpt-web` fork relative to
`miuuyy/codex-chatgpt-web` at upstream `92a356fac2292e3af5a97ab7ba634edd8d38621e`.
The pre-audit fork head was `75f501ffce5d84d43013ff249a69c7be22ba9e0d`
(reliability revision `v6.1.5-r10`).

The repository tree inventory has 293 file blobs; 34 paths diverge from the
upstream tree, including fork-only tests/workflows/docs. The risk-driven code review
inspected the launcher, bridge, browser worker, helper IPC, model selection, broker,
prompt, recovery, tests, CI, updater, runtime manifest integrity, and authenticated
control server, together with four cumulative browser diagnostic exports.

**Do not interpret this as mathematical proof that all possible bugs are absent.**
Automated tests and source review cannot reproduce every version of ChatGPT's SPA,
account state, network environment, Windows host, or live external service condition.
An authenticated, controlled live end-to-end suite and fault-injection lab remain
necessary to certify those paths.

## Confirmed history and root-cause assessment

1. **Official v6.1.5: premature 20-second Send verdict.** A large inline turn
   could activate Send without observable acknowledgement before the fixed 20s
   stage deadline. The fork increased normal Send to 60s (r8). This was a real
   local observer-policy defect; the log does *not* prove an OpenAI outage.
2. **r8: inaccessible post-tool recovery across IPC.** The daemon constructed
   `prepareRecovery`, but the launcher/browser helper process lacked the
   capability negotiation and prompt request/ack transport. r9 added
   `stall-recovery-prompt`, `recoveryAvailable`,
   `recovery_prepare_requested`, and `recovery_prepared_ack`, with
   cross-process regression coverage.
3. **r9: fixed 60-second Send verdict on large inline context.** A later
   247,006-character / about 73,162-estimated-input-token task hit the 60s
   acceptance deadline with no confirmed evidence. r10 uses a bounded 180s
   acceptance window for >=200k inline characters or >=60k estimated message
   tokens; ordinary Send remains 60s.
4. **r10 residual uncertainty.** The larger budget prevents the specific
   premature 60s verdict; it does not establish why the site delayed
   acknowledgement or guarantee it will respond inside 180s. An unconfirmed
   Send MUST NOT be blindly reissued because Codex Native tool operations might
   have completed on the remote turn.
5. **r11 audit finding: model-control misattribution.** Failure to verify the
   chosen model control, which can arise from selector/DOM drift or UI state,
   incorrectly used `upstream_server_error`. The r11 patch uses
   `chatgpt_ui_controls_unverified` instead, preserving fail-closed semantics.
6. **r11 audit finding: missing provenance on browser failures.** r11 adds
   content-free structured diagnostics for stage deadlines and submitted turns.
   The diagnostic records phase/stage, local timeout, budget, elapsed time,
   sleep credit, MCP revision, active calls and causal evidence category.
7. **r11 audit finding: auxiliary URL origin verification.** Several launcher
   navigation and ownership checks used `startsWith(CHATGPT_ORIGIN)` on a URL
   string. The boundary now uses `new URL(value).origin === CHATGPT_ORIGIN`
   and rejects lookalike hosts and URL userinfo tricks.

These snapshots are **cumulative**. Do not add event totals across their four
exports as if they were four separate runs.

## Evidence model for external vs internal failures

| Category | Admissible evidence | Interpretation |
|---|---|---|
| `integration_verified` | E.g. verified attached-prompt integrity mismatch | Local adapter/integration integrity failure |
| `chatgpt_ui_observed` | Explicit current ChatGPT error alert, rate-limit dialog or expired-session alert | A UI signal was observed. This does **not** independently prove an OpenAI server root cause |
| `unattributed` | Send not acknowledged, stage timeout, missing controls, unknown exception, network ambiguity | Origin remains **undetermined** pending more evidence |

The Responses API `server_error` **transport category is not root-cause attribution**.
Do not label every 502, timeout, renderer stall, or missing DOM element as an
OpenAI outage. Do not label a generic network error as an application defect
without a causal trace either.

Minimum telemetry to preserve per turn: unique trace ID, build revision,
selected model/effort, transport (inline/multipart), size/token estimate,
phase, active stage and budget, send activation vs acceptance evidence,
MCP requests/results/outstanding count, helper feature set and restart/rebind
attempts, response projection and terminal verdict, observed UI/network
failure signals, cancellation reason, and timestamp. Avoid raw prompts,
auth headers, cookies, broker secrets, and user content.

## Cross-component review

| Subsystem | What is already defended | Residual limitation / follow-up |
|---|---|---|
| Prompt and token transport | Validated inline limits; staged multipart with distinct acknowledgement | Large inline sends depend on variable SPA acknowledgement; dynamic budget is mitigation, not certainty |
| Browser Send ownership | `send_activated` vs `accepted` distinguished; no unsafe automatic resend | A submitted but unacknowledged request can remain indeterminate |
| Helper IPC | Negotiated capabilities; tool progress mirror; r9 recovery request/ack | Exercise helper crash/restart exactly while recovery ACK is in flight |
| Tool broker | Retired capability rejection, active-tool progress, completion fence | Newly generated semantic duplicate mutations cannot always be recognized from tool IDs alone |
| Response parsing/DOM | Response identity, text/markdown projection, quiescent recovery | SPA markup drift and incomplete finalization require live fixtures |
| Cancellation/compaction | Owner/session lifecycle and compaction handoff tests | Race injection around sleep/wake, process termination, delayed tool results |
| Launcher/security | Loopback bearer-token control plane; hashed runtime manifest; auth separation | Host-specific permissions, updater edge cases and actual signed installs require host-level testing |
| Diagnostics/privacy | Redacted structural DOM snapshots and opt-in screenshot capture | Screenshots can contain sensitive content; use only in explicitly approved debugging environments |
| Dependency/build | Root + launcher audits and frozen installs included in `verify` | Audits are point-in-time; external advisories and drift need recurring review |
| Release/CI | Cross-platform `verify`, package and smoke; separate Windows reliability build | CI cancellation/queue saturation during multi-commit main updates reduced conclusive check coverage |

## High-priority risk register

- **R1 (high):** Ambiguous Send or response completion cannot be proven remote or local from timeout alone. Mitigation: fail closed, preserve causal evidence; do not replay mutations. Live fault injection still open.
- **R2 (high):** Browser UI/selector drift can masquerade as service failure. Partial remediation in r11; more multi-version fixtures are needed.
- **R3 (high):** Recovery prompts rely on the model not repeating already-performed *semantic* mutations. Transport-level call identity is protected, but arbitrary commands do not all have idempotency keys. Require a controlled mutation ledger or explicit user verification for ambiguous side effects before enabling any automated replay.
- **R4 (medium):** r10 payload-aware 180s Send budget is heuristic. Collect size vs acknowledgement observations and examine multipart/shorter transports under real workloads.
- **R5 (medium):** CI can be canceled by bursty PR/ref updates. Final SHA requires a complete independent run; do not treat the green branch artifact alone as complete post-merge coverage.
- **R6 (medium):** Live OpenAI faults, Cloudflare challenges, login expiry and model limits are not fully reproducible in unauthenticated CI.
- **R7 (medium):** Opt-in screenshots may contain conversation material. Keep disabled by default, restrict permissions and retention, and never upload raw content to public bug reports.
- **R8 (remediated in r11):** Auxiliary launcher ownership/authentication checks used URL string prefixes, which could recognize lookalike hosts as the ChatGPT origin. Replaced with exact parsed URL `origin` comparison and added hostname-prefix/userinfo/scheme regressions.

## Release gate

The release should be treated as fully CI-qualified only when all of the
following correspond to the **same intended source head**:

- frozen dependency installation, root and launcher audit/typecheck/tests;
- production runtime bundle and native launcher package build;
- Windows, Linux and macOS smoke tests;
- cross-process helper IPC/recovery tests;
- artifact upload, manifest and hash verification;
- actual signed-in ChatGPT smoke with a short task and an instrumented,
  non-mutating long-context test, where credentials and account permission allow;
- negative tests: offline DNS, transient 429/5xx, expired session, Cloudflare,
  browser rebind, late MCP result, abort during recovery, malformed IPC, and
  crash-restart before/after Send.

A normal GitHub Actions green badge verifies **only the jobs actually executed**.
It does not warrant permanent uptime or correctness of changing third-party UI.

## Change policy

Keep upstream sync separate from hardening fixes. Each change requires a
reproducible scenario, explicit invariant, unit/integration test, impact on
cancellation and side effects, and CI/artifact evidence. Do not increase
timeouts in response to an unknown failure without explaining what independent
liveness/acceptance evidence will be accepted and why the chosen bound is safe.
