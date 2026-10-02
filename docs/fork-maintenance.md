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

- Native upstream base: **v6.1.4**
- Upstream v6.1.4 commit merged into this fork:
  `b6ca2d3f91f8a2ba140b522fe3b3c50b4ebffa2d`
- Merge/pruning commit:
  `0bf0a6d277900d6f74677f263e21fc4e921aab06`

### Upstream v6.1.4 behavior adopted natively

The fork intentionally uses the v6.1.4 native implementations for:

- cancellation/helper crash fixes;
- reply and formula/Markdown parsing improvements;
- follow-up plugin revalidation/selection;
- Activity/approval UI handling;
- compaction/summary fixes;
- updater proxy support;
- dependency/runtime updates.

The previous fork-specific repeated-Markdown/formula workaround was removed when
v6.1.4 superseded it.

## Fork-specific reliability behavior still retained

These remain because v6.1.4 does not fully cover the observed failure modes:

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

- fully quiescent post-tool recovery window: **2 minutes**;
- one same-conversation recovery is allowed when no tool call is in flight;
- recovery may run even if a partial final answer was already streamed;
- the continuation prompt explicitly forbids repeating already emitted answer
  text or completed tool mutations;
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
- primary ACK waits are bounded to **45 seconds** and receipt-recovery ACK waits
  to **20 seconds** instead of consuming the full 180-second DOM grace;
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

Current multipart performance policy additionally avoids 180-second receipt
stalls, full-transaction restart on a safely disambiguated renderer re-key, and
redundant full model-picker verification on every inert context part.

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
