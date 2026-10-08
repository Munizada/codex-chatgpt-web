# Fork Maintenance Notes

This file is the canonical record for the custom reliability work maintained in
`Munizada/codex-chatgpt-web`.

## Maintenance policy

- Upstream: `miuuyy/codex-chatgpt-web`.
- Fork: `Munizada/codex-chatgpt-web`.
- Track upstream releases first and prefer native upstream behavior whenever it
  fully replaces a fork patch.
- Remove superseded fork code instead of keeping duplicate implementations.
- Keep only the smallest fork-specific changes still required for observed bugs.
- Preserve fail-closed behavior for ambiguous turn binding, multipart transport,
  completion, and local-tool execution.
- Every reliability change must include regression coverage and pass Linux,
  macOS, Windows, packaging, and Windows smoke validation before a build is
  treated as final.

## Current base

- Native upstream base: **v6.1.5**
- Upstream v6.1.5 release commit integrated into this fork:
  `92a356fac2292e3af5a97ab7ba634edd8d38621e`
- Fork reliability revision: **v6.1.5-r11**

### v6.1.5-r11 audit hardening

The browser now bounds `prepareRecovery` to 60 seconds and releases any recovery prompt that arrives after its stage is abandoned. The diagnostics attach a conservative `faultAttribution` field: explicit ChatGPT UI states are marked as observed UI evidence, local cancellations remain local, and timeouts, network, Playwright and parser errors remain undetermined without corroborating evidence. These classifications are evidence labels, not proof of OpenAI server culpability.


### v6.1.5-r10 large inline Send budget

A production diagnostic showed a valid inline turn with 247,006 characters and about 73,162 estimated input tokens exhausting the fixed 60-second Send acceptance window before ChatGPT exposed semantic acceptance evidence. r10 keeps ordinary turns at 60 seconds but gives objectively large inline payloads the existing bounded 180-second ingestion budget used by Bigger Context. The selected budget is logged with transport, character count, and estimated tokens for future diagnostics.

### v6.1.5-r9 launcher recovery fix

A production diagnostic showed that `prepareRecovery` existed in the daemon but was lost when launcher browser work crossed into the out-of-process helper. The helper therefore logged `prepareRecovery=false` and could only rebind/fail after a quiescent post-tool stall. r9 adds an explicitly negotiated `stall-recovery-prompt` helper capability and a dedicated request/ack protocol so the helper can obtain the minimal same-conversation recovery prompt only when a proven stall occurs.

### Upstream v6.1.5 behavior adopted natively

The fork keeps the v6.1.4 fixes and adopts the v6.1.5 implementations for:

- context-upload sizing and multipart-history reconciliation;
- browser response-health and incomplete-response classification;
- current tool-approval DOM surfaces and one-time approval handling;
- SSE/HTTP oversized-submission rejection detection;
- Think-mode and connector-selection preservation;
- Markdown/resource-preview stability;
- saved thread-environment corruption recovery;
- current model/token limits and dependency/runtime security updates.

Fork code is retained only where the observed failures still require stronger
bounded recovery or platform hardening than upstream provides.

## Fork-specific reliability behavior still retained

These remain because v6.1.5 does not fully cover the observed failure modes:

- safe assistant-turn DOM rebind/re-key handling;
- post-tool detached-assistant recovery;
- bounded MCP/exec/write-stdin yield behavior;
- stale external-progress ceiling so lost MCP state cannot hold a turn forever;
- same-conversation recovery for stalled finalization;
- partial-final-answer recovery that continues without duplicating already
  emitted user-facing text;
- post-tool quiescence watchdog;
- `Answer now` fallback after a proven running stall;
- Bigger Context multipart ACK recovery after both timeout and incorrect ACK,
  without replaying an already accepted large payload;
- fork-aware update channel behavior;
- Windows packaging/smoke hardening.

## Current post-tool stall policy

The observed long-task failure mode was:

1. all local tool work completed;
2. no MCP calls remained active;
3. ChatGPT stayed on an Activity/assistant shell without a serializable final
   answer;
4. the browser bridge waited a full watchdog window, rebound the page, waited a
   second watchdog window, then failed.

Current fork behavior:

- fully quiescent post-tool recovery window: **60 seconds**;
- one same-conversation recovery is allowed when no tool call is in flight;
- ordinary turns may recover after a partial final answer, and the continuation
  prompt explicitly forbids repeating already emitted answer text or completed
  tool mutations;
- Luna rolling-checkpoint turns recover only before any final-answer character
  has been emitted; once checkpoint-bearing output has started, the bridge fails
  closed instead of risking duplicate or corrupted checkpoint state;
- the recovery watchdog is deliberately given priority over v6.1.5's terminal
  incomplete-response verdict at the same 60-second boundary;
- transport-only rebinds no longer reset the stall timer when the observed state
  has not changed, avoiding a second full grace period;
- genuine fresh progress still resets the trackers normally.

Relevant commits:

- `5f100e864f094a32d7f7481b25f424bf85fdc62f` — recover idle
  post-tool stalls sooner;
- `2941c0e0bc0d15a6e7af0c56b5c83df397e29b1f` — safe partial-answer
  continuation;
- `5cba520848f574b9ae2681d1999e10216a215a26` — prefer safe batching of
  independent local checks;
- `a852f59bddb98eafbe43b03eb8360e6c4a18f805` — avoid a second stall
  grace after browser rebind.

## Bigger Context / multipart transport

Observed failure modes:

- staged part accepted but acknowledgement response timed out;
- staged part accepted but ChatGPT returned the wrong acknowledgement;
- the renderer briefly exposed two new user-turn identities during one physical
  staged Send, causing the whole multipart attempt to restart;
- repeated full model-picker selection between inert stages added avoidable UI
  latency.

Fork behavior:

- never replay the already accepted large staged payload merely because its ACK
  failed;
- the first staged ACK keeps the full **180-second** headroom because historical
  successful first-part receipts have legitimately taken roughly 160 seconds;
- later staged ACKs use a **60-second** window: across the reviewed diagnostics,
  successful parts 2-5 stayed below roughly 52 seconds;
- receipt-recovery ACK waits use **20 seconds** because the recovery prompt is
  tiny and observed successful recovery receipts stayed below roughly 10 seconds;
- request only the exact missing transaction receipt in the same conversation;
- accept the recovery only when the exact expected ACK is observed;
- when multiple new user identities appear during Send, accept one only if its
  message-content target exactly matches the submitted prompt; ambiguity still
  fails closed;
- reuse an already-proven staging model/effort selection on the same surface
  with a lightweight semantic check, re-selecting only when that proof no
  longer holds;
- otherwise fail closed.

Relevant commits:

- `fff2301a5e7206712b471e912e577d68927eb69b` — timeout recovery;
- `b163aaf988c8eb4812397839072bcf39c87b1b45` — incorrect-ACK recovery.

## Performance policy

Do not alter model reasoning quality merely to make a task look faster.

Fork-side overhead should be kept as close to zero as practical:

- deliver settled tool results promptly;
- avoid unnecessary grace windows or duplicated watchdog waits;
- prefer event/progress evidence over blind waiting;
- permit safe batching/parallel execution only for independent local reads,
  checks, or operations;
- keep dependent mutations and verification ordered.

When diagnosing slow tasks, separate:

1. actual local tool execution time;
2. model time between tool calls;
3. browser/bridge waiting and recovery time.

Only category 3 is considered avoidable bridge overhead.

Current multipart performance policy avoids 180-second receipt stalls on
follow-up parts, full-transaction restart on a safely disambiguated renderer
re-key, and redundant full model-picker verification on every inert context
part. The first staged receipt deliberately keeps the larger historical safety
window rather than trading reliability for a few seconds.

## Temporary dependency-audit exception

As of 2026-10-03, GitHub Advisory `GHSA-ch52-4w7c-c8xp` affects
`http-cache-semantics <=4.2.0` and has no published patched npm version. In
this repository it is reachable only through launcher build-time
`devDependencies` (`electron -> @electron/get -> got -> cacheable-request`
and the equivalent `electron-builder` path).

The launcher audit therefore:

1. runs `bun audit --prod` with no exception for shipped production
   dependencies;
2. runs the full audit while ignoring only
   `GHSA-ch52-4w7c-c8xp`.

Any other production or development advisory still fails verification. Remove
this exception as soon as a patched dependency chain is published.

## Validation contract

Before publishing a patched Windows executable:

- `bun run verify` must pass;
- Linux verification must pass;
- macOS verification/package/smoke must pass;
- Windows verification/package/smoke must pass;
- workflow/actionlint must pass;
- the artifact must be built from the current `main` commit.

## Release-upgrade checklist

For every new upstream release:

1. compare the previous upstream tag to the new release;
2. compare the new upstream implementation against every retained fork patch;
3. identify fork behavior now provided natively;
4. remove superseded or duplicated fork code;
5. adapt retained patches to new upstream signatures/DOM behavior;
6. add or update regression tests;
7. merge the upstream release into `main`;
8. run full CI/package/smoke validation;
9. update this document with the resulting retained patch set.
