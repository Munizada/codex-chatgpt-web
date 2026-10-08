# Fork reliability audit — 2026-10-07

> Status: continuous audit and hardening, not a certification of zero defects.
> Baseline: fork `75f501ffce5d84d43013ff249a69c7be22ba9e0d` (v6.1.5-r10),
> upstream `92a356fac2292e3af5a97ab7ba634edd8d38621e` (v6.1.5).

## Source and build evidence

- Git tree inventory: 293 tracked files in the fork; 34 files differ from upstream (including fork-specific files).
- The r10 reliability workflow completed successfully on `main`. The r10 CI workflow was cancelled by Actions, not marked successful; successful PR-branch CI used an identical Git tree.
- `bun run verify` checks version, both dependency audits, TypeScript, runtime and launcher suites, renderer build, runtime bundle, notices and a runtime smoke. Workflow package/smoke also checks packaged launchers.
- This does **not** run an authenticated live ChatGPT server/UI session; production latency, UI virtualization, Cloudflare challenges and MCP timing remain externally variable.

## Failure history and evidence-based interpretation

| Observation | Immediate cause | Fix / defense | Residual limitation |
| --- | --- | --- | --- |
| Official 6.1.5 died at 20-second Send boundary | Premature local Send observation deadline | r8 60-second bounded initial acceptance window | A very large inline message can still exceed 60 seconds |
| r8 recognized Send/tools but had `prepareRecovery=false` in helper | Daemon-only recovery callback not transported across IPC | r9 negotiated helper recovery request/ack | Recovery preparation itself had no specific deadline |
| r9 timed out on ~247k-character inline Send at ~60 seconds | Fixed 60-second Send stage even for large inline context | r10 payload-aware 180-second ceiling for large inline turns | Timeout with no acceptance evidence is **indeterminate**, not proof of a server outage |
| Main CI jobs were cancelled despite later main commit | Actions concurrency shared one pending group for all main SHAs | r11 isolates `main` workflow groups per SHA, retains PR supersession | Each release still needs a successful end-to-end CI run for its exact commit |
| Recovery prompt preparation can await IPC indefinitely | No timeout around `prepareRecovery` | r11 bounded stage, late prompt lease release | Unknown remote delay can still lead to a fail-closed outcome |
| Browser failures lack explicit provenance evidence | Generic errors alone cannot distinguish local, browser/transport and backend | r11 diagnostic fault attribution for confirmed UI/control cases and undetermined others | An observed UI state is not proof of the underlying OpenAI infrastructure root cause |

## Surfaces re-reviewed

- Runtime: browser stages, Send acceptance, DOM observation, quiescent recovery, completion fences, turn broker, event transport, prompt compilation and multipart contract.
- IPC: daemon/client/helper feature negotiation, prepared prompt lifecycle, cancel/abort, progress mirroring, tool boundaries and completion.
- Launcher: loopback bearer-token control API, request validation, process shutdown, runtime installation/updates, Windows packaging and smoke.
- CI: workflow triggers, concurrency, cross-platform verify, audit commands, Windows baseline runtime, installer and smoke.
- Logs: cumulative diagnostic captures for r7/r8/r9, including stage timeouts and helper activity; these are cumulative exports, not independent reproduction counts.

## Assurance limits and next verification requirements

1. The GitHub-hosted tests prove contract behavior for simulated scenarios, not that a logged-in ChatGPT session will always accept a message before any deadline.
2. Timeout without a current-turn response, tool boundary or explicit UI error is **undetermined**. Never assign it automatically to OpenAI or automatically resend a potentially accepted message.
3. True external origin requires corroboration such as an explicit UI error, network status captured independently, or service status evidence. A visible error can support a UI-state observation but not the precise backend root cause.
4. Production end-to-end soak testing with multiple account types, large inline and multipart messages, browser suspension, denied tool permissions, slow tools, cancellation and session expiry remains necessary.
5. Every future bugfix should include a regression test, a Windows packaged runtime smoke and a diagnostic-origin review. Changes to timeout thresholds should be measured rather than substituted for protocol fixes.

## Review verdict

The known r7–r10 regressions have targeted repairs and automated checks, but the project cannot be certified as zero-bug or externally fault-proof. The current audit reinforces one confirmed unbounded recovery path and improves truthful error attribution. Remaining risks above are explicit, not silently reclassified as resolved.
