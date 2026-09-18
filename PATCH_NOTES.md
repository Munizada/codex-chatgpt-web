# Bigger Context stability patch — v5.0.8

## Purpose

Keep the local Bigger Context stability fix easy to port to future upstream releases if the project has not incorporated an equivalent fix.

## Known-good baseline

- Upstream version: v5.0.8
- Patched fork commit: `73b30f4667d41ac5490764b36335de88c138435d`
- Snapshot branch: `patches/bigger-context-stability-v5.0.8`
- Original implementation PR in this fork: #2

## Behavior changed

- Bigger Context multipart transport accepts 2–8 parts.
- Once multipart is needed, stages target roughly 40k input tokens instead of pushing ~60k+ into a stage.
- ~138k-token workloads select 4 parts instead of 2 oversized stages.
- Compaction enters multipart before the legacy inline byte cap can reject a large compaction prompt.
- Multipart ACK observation rebinds to the latest assistant shell when ChatGPT creates transient response turns.
- Existing SHA-256 manifests, ordering, fail-closed ACK behavior, and duplicate-send protections remain intact.

## Files touched

- `src/adapters/chatgpt-web/prompt.ts`
- `src/adapters/chatgpt-web/usage.ts`
- `src/adapters/chatgpt-web/browser-worker.ts`
- `src/adapters/chatgpt-web/browser-helper-main.ts`
- `tests/chatgpt-web-usage.test.ts`
- `tests/browser-worker-contract.test.ts`

## Validation on v5.0.8

- Windows: verify PASS, package PASS, smoke PASS
- Linux: verify PASS, package PASS, ABI PASS, smoke PASS
- macOS: verify PASS. PR package verification failed only because PR builds skip signing and strict codesign validation rejects the unsigned package.

## Porting checklist for a future upstream update

1. Sync the fork with upstream.
2. Check whether upstream already contains equivalent adaptive multipart + ACK rebind logic.
3. If upstream has an equivalent fix, do not reapply this patch blindly; validate the ~138k-token case and retire this snapshot if behavior is equivalent.
4. If upstream does not have the fix, compare or cherry-pick this snapshot and resolve conflicts against the new source.
5. Preserve all new upstream safety/hotfix changes; never replace whole files with these old versions.
6. Re-run the full test suite.
7. Specifically verify that ~138k input does not select `multipart-2` with ~60k+ staging messages.
8. Build and smoke-test Windows before installing.

## Expected regression signal

Before the patch, the failing case looked like:

```
estimatedInputTokens ~= 138000
transport = multipart-2
stage size ~= 60k+
multipart_stage_1_acknowledgement timeout
```

Expected patched behavior is roughly:

```
estimatedInputTokens ~= 138000
transport = multipart-4
stage size ~= 35k-40k
ACK proceeds stage by stage
```
