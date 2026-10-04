import { expect, test } from "bun:test";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint, isWindowsPipeEndpoint } from "../src/config";

test.skipIf(process.platform === "win32")("closing a rejected broker leaves the live socket reachable", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-owner-"));
  const endpoint = join(root, "broker.sock");
  const server = createServer(socket => {
    socket.once("data", bytes => {
      const request = JSON.parse(bytes.toString().trim());
      socket.end(JSON.stringify({ id: request.id, result: { ready: true } }) + "\n");
    });
  });
  const contender = TurnBroker.forSocket(endpoint);
  try {
    await new Promise<void>(resolve => server.listen(endpoint, resolve));
    chmodSync(endpoint, 0o600);
    await expect(contender.listen()).rejects.toThrow("already owned by another process");
    await contender.close();
    await contender.close();
    expect(existsSync(endpoint)).toBeTrue();
    expect(await callTurnBroker<{ ready: boolean }>(endpoint, { method: "owner_status" })).toEqual({ ready: true });
  } finally {
    await contender.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit browser-turn cancellation aborts and removes every registered session", async () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const replayable = sessions.getOrCreate("turn-a", () => ({
    mode: "read-only",
    browser: Promise.resolve("done"),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));
  await replayable.browserOutcome;
  sessions.getOrCreate("turn-b", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));

  expect(sessions.activeCount()).toBe(1);
  expect(sessions.clear()).toBe(2);
  expect(cancelled).toBe(2);
  expect(sessions.activeCount()).toBe(0);
});

test("targeted tab cancellation settles one trace and keeps a terminal replay tombstone", async () => {
  const sessions = new ChatGptTurnSessions();
  let rejectTarget!: (error: Error) => void;
  let targetCancelled = 0;
  let otherCancelled = 0;
  const target = sessions.getOrCreate("target", () => ({
    mode: "read-only",
    browser: new Promise<string>((_resolve, reject) => { rejectTarget = reject; }),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => {
      targetCancelled += 1;
      rejectTarget(new Error("browser tab closed by user"));
    },
  }), "trace_target");
  sessions.getOrCreate("other", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { otherCancelled += 1; },
  }), "trace_other");

  expect(await sessions.cancelTrace("trace_target")).toBe(1);
  expect(targetCancelled).toBe(1);
  expect(otherCancelled).toBe(0);
  expect(target.settledOutcome()).toMatchObject({ type: "error" });
  expect(sessions.activeCount()).toBe(1);
  expect(sessions.getOrCreate("target", () => {
    throw new Error("a cancelled continuation must not open a new browser tab");
  }, "trace_target")).toBe(target);
  expect(await sessions.cancelTrace("trace_target")).toBe(0);
  sessions.clear();
});

test("native interruption retires only the exact browser turn identity", async () => {
  const sessions = new ChatGptTurnSessions();
  const cancelled: string[] = [];
  const runtime = (name: string) => {
    let rejectBrowser!: (error: Error) => void;
    const browser = new Promise<string>((_resolve, reject) => { rejectBrowser = reject; });
    return {
      mode: "read-only" as const,
      browser,
      physicalSettlement: browser.then(() => undefined, () => undefined),
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      cancel: (reason?: Error) => {
        cancelled.push(name);
        rejectBrowser(reason ?? new Error("cancelled"));
      },
    };
  };
  sessions.getOrCreate(
    "target",
    () => runtime("target"),
    "trace_target",
    "owner_target",
    "turn_shared",
    "thread_target",
  );
  sessions.getOrCreate(
    "other-thread",
    () => runtime("other-thread"),
    "trace_other",
    "owner_other",
    "turn_shared",
    "thread_other",
  );

  const cancellation = sessions.cancelNativeTurn(
    "thread_target",
    "turn_shared",
    new DOMException("Codex turn interrupted", "AbortError"),
  );
  expect(cancellation.cancelled).toBe(1);
  await cancellation.settlement;
  expect(cancelled).toEqual(["target"]);
  expect(sessions.find("target")).toBeUndefined();
  expect(sessions.find("other-thread")?.nativeThreadId).toBe("thread_other");
  expect(sessions.activeCount()).toBe(1);
  sessions.clear();
});

test("session cache expiry never cancels a still-active long browser turn", async () => {
  const sessions = new ChatGptTurnSessions(1);
  let cancelled = 0;
  const active = sessions.getOrCreate("long-turn", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));

  await Bun.sleep(5);
  expect(sessions.activeCount()).toBe(1);
  expect(sessions.getOrCreate("long-turn", () => {
    throw new Error("active session must be reused");
  })).toBe(active);
  expect(cancelled).toBe(0);
  sessions.clear();
});

test("five active turns coexist and a sixth fails closed", () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const runtime = () => ({
    mode: "read-only" as const,
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  });

  const active = Array.from({ length: 5 }, (_unused, index) => (
    sessions.getOrCreate(`turn-${index + 1}`, runtime)
  ));
  expect(sessions.activeCount()).toBe(5);
  expect(cancelled).toBe(0);
  expect(() => sessions.getOrCreate("turn-6", runtime)).toThrow("at most 5 simultaneous browser turns");

  expect(sessions.getOrCreate("turn-3", () => {
    throw new Error("an in-flight turn must be reused");
  })).toBe(active[2]);
  expect(cancelled).toBe(0);
  sessions.clear();
  expect(cancelled).toBe(5);
});

test("settled replay sessions expire from their last use instead of their creation time", async () => {
  const sessions = new ChatGptTurnSessions(50);
  let starts = 0;
  const start = () => {
    starts += 1;
    return {
      mode: "read-only" as const,
      browser: Promise.resolve("done"),
      physicalSettlement: Promise.resolve(),
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      cancel: () => {},
    };
  };
  const first = sessions.getOrCreate("replay", start);
  await first.browserOutcome;
  await Bun.sleep(10);
  expect(sessions.getOrCreate("replay", start)).toBe(first);
  await Bun.sleep(70);
  expect(sessions.getOrCreate("replay", start)).not.toBe(first);
  expect(starts).toBe(2);
  sessions.clear();
});

test("turn broker creates its private runtime directory on a cold start", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 10_000);
    if (process.platform === "win32") {
      expect(isWindowsPipeEndpoint(socketPath)).toBe(true);
    } else {
      expect(existsSync(socketPath)).toBe(true);
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
    }
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("turn broker rejects a Unix socket path that leaves no room for sun_path's NUL terminator", async () => {
  if (process.platform === "win32") return;
  const socketPath = `/tmp/${"x".repeat(99)}`;
  expect(Buffer.byteLength(socketPath)).toBe(104);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    await expect(broker.listen()).rejects.toThrow("103-byte limit");
  } finally {
    await broker.close();
  }
});

test("turn broker tokens do not expire while their browser turn is still alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-unbounded-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    });
    await Bun.sleep(5);
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token }))
      .resolves.toMatchObject({ bindingId: expect.any(String) });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("turn broker revokes only channels owned by the closed browser trace", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-targeted-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const environment = {
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" as const },
      tools: [],
    };
    const target = await broker.register(environment, 60_000, "trace_target");
    const other = await broker.register(environment, 60_000, "trace_other");
    expect(broker.revokeTrace("trace_target")).toBe(1);
    await expect(callTurnBroker(socketPath, { method: "claim", token: target }))
      .rejects.toThrow("already finished");
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token: other }))
      .resolves.toMatchObject({ bindingId: expect.any(String) });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function unansweredBrokerEndpoint(name: string, onConnection: (socket: Socket) => void) {
  const root = mkdtempSync(join(tmpdir(), name));
  const socketPath = defaultBrokerEndpoint(root);
  if (!isWindowsPipeEndpoint(socketPath)) mkdirSync(dirname(socketPath), { recursive: true });
  const server = createServer(onConnection);
  return {
    socketPath,
    listen: () => new Promise<void>(ready => server.listen(socketPath, ready)),
    close: async () => {
      await new Promise<void>(done => server.close(() => done()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("an unbounded broker call fails when the broker closes without answering", async () => {
  const broker = unansweredBrokerEndpoint("cgw-broker-closed-", socket => socket.on("data", () => socket.end()));
  await broker.listen();
  try {
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token: "turn_closed" }, null))
      .rejects.toThrow("closed the connection");
  } finally {
    await broker.close();
  }
}, 10_000);

test("bounded broker calls preserve server-owned closure before advancing the lifecycle", async () => {
  let peer!: Socket;
  let finishFrame!: () => void;
  const frameWritten = new Promise<void>(resolve => { finishFrame = resolve; });
  const broker = unansweredBrokerEndpoint("cgw-broker-frame-", socket => {
    peer = socket;
    socket.once("data", chunk => {
      const request = JSON.parse(chunk.toString().trim());
      const frame = JSON.stringify({ id: request.id, result: { ready: true } }) + "\n";
      socket.write(frame.slice(0, -1));
      setImmediate(() => { socket.write(frame.slice(-1)); finishFrame(); });
    });
  });
  await broker.listen();
  try {
    let settled = false;
    const call = callTurnBroker(broker.socketPath, { method: "owner_status" }).then(result => {
      settled = true;
      return result;
    });
    await frameWritten;
    await Bun.sleep(25);
    expect(settled).toBeFalse();
    peer.end();
    await expect(call).resolves.toEqual({ ready: true });
  } finally {
    peer?.destroy();
    await broker.close();
  }
});

test("broker frame settlement still rejects errors, wrong identities and incomplete replies", async () => {
  for (const [reply, expected] of [
    [(id: string) => JSON.stringify({ id, error: "claim rejected" }) + "\n", "claim rejected"],
    [() => '{"id":"another","result":true}\n', "response id mismatch"],
    [() => 'null\n', "invalid response frame"],
    [(id: string) => JSON.stringify({ id, result: true, error: "contradiction" }) + "\n", "invalid response frame"],
    [(id: string) => JSON.stringify({ id }), "closed the connection"],
    [() => '{broken}\n', "invalid JSON"],
  ] as const) {
    const broker = unansweredBrokerEndpoint("cgw-broker-reject-", socket => {
      socket.once("data", chunk => socket.end(reply(JSON.parse(chunk.toString().trim()).id)));
    });
    await broker.listen();
    try {
      await expect(callTurnBroker(broker.socketPath, { method: "owner_status" })).rejects.toThrow(expected);
    } finally { await broker.close(); }
  }
});

test("an unbounded broker call outlives the bounded default timeout", async () => {
  const accepted: Socket[] = [];
  const broker = unansweredBrokerEndpoint("cgw-broker-slow-", socket => { accepted.push(socket); });
  await broker.listen();
  try {
    const call = callTurnBroker(broker.socketPath, { method: "claim", token: "turn_unbounded" }, null);
    const outcome = await Promise.race([
      call.then(() => "settled", () => "settled"),
      Bun.sleep(5_300).then(() => "pending"),
    ]);
    expect(outcome).toBe("pending");
  } finally {
    for (const socket of accepted) socket.destroy();
    await broker.close();
  }
}, 15_000);

test("turn broker names the finished turn that owns a replayed handle", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "turn-alpha");
    await expect(callTurnBroker(socketPath, { method: "claim", token: ` ${token}` }))
      .rejects.toThrow("turn token is invalid, expired, or revoked");
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    broker.revoke(token);

    const rejection = async (request: Parameters<typeof callTurnBroker>[1]): Promise<string> => {
      try {
        await callTurnBroker(socketPath, request);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error("turn broker accepted a handle it should have rejected");
    };

    const replayedBinding = await rejection({
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
    });
    expect(replayedBinding).toContain("turn-alpha");
    expect(replayedBinding).toContain("has already finished");
    expect(replayedBinding).not.toContain("codex_bind_turn");

    const replayedToken = await rejection({ method: "claim", token });
    expect(replayedToken).toContain("turn-alpha");
    expect(replayedToken).toContain("can no longer run");
    expect(replayedToken).not.toContain("current task context");

    const unknownBinding = await rejection({
      method: "invoke",
      bindingId: "binding_never-issued",
      wireName: "exec_command",
    });
    expect(unknownBinding).toBe("internal Codex turn binding is invalid or expired");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("a delivered tool timeout is isolated until its late native result settles", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-ad-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "trace_abandon");
    const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(
      socketPath,
      { method: "claim", token },
    );
    const callId = "call_abandonedDelivered1234567890";
    const invocation = callTurnBroker(
      socketPath,
      {
        method: "invoke",
        bindingId: claimed.bindingId,
        callId,
        wireName: "mcp__agent_browser__agent_browser_open",
        freeform: false,
        arguments: { url: "https://example.invalid" },
      },
      null,
    );
    await expect(broker.nextToolBatch(token)).resolves.toEqual([
      expect.objectContaining({ callId, wireName: "mcp__agent_browser__agent_browser_open" }),
    ]);

    const invocationOutcome = invocation.then(
          value => ({ type: "value" as const, value }),
          error => ({ type: "error" as const, error: error instanceof Error ? error : new Error(String(error)) }),
        );
    await expect(callTurnBroker(socketPath, {
      method: "abandon_invoke",
      bindingId: claimed.bindingId,
      callId,
      failure: {
        code: "codex_tool_timeout",
        tool: "mcp__agent_browser__agent_browser_open",
        timeoutMs: 110_000,
      },
    })).resolves.toEqual({ abandoned: true, delivered: true });
    const settledInvocation = await invocationOutcome;
        expect(settledInvocation.type).toBe("error");
        if (settledInvocation.type !== "error") throw new Error("abandoned invocation unexpectedly resolved");
        expect(settledInvocation.error.message).toContain("exceeded its MCP transport deadline");

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: claimed.activityId,
    });
    expect(broker.beginCompletionFence(token)).toBeUndefined();

    expect(() => broker.completeTool(token, callId, {
      content: [{ type: "text", text: "late result" }],
    })).not.toThrow();
    expect(broker.beginCompletionFence(token)).toEqual(expect.any(Number));

    const secondClaim = await callTurnBroker<{ bindingId: string; activityId: string }>(
      socketPath,
      { method: "claim", token },
    );
    expect(secondClaim.bindingId).toBe(claimed.bindingId);
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: secondClaim.activityId,
    });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a delivered timed-out invocation retires the turn if native settlement never arrives", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-ag-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath, { abandonedToolSettlementGraceMs: 100 });
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "trace_abandon_grace");
    const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(
      socketPath,
      { method: "claim", token },
    );
    const callId = "call_abandonedGrace1234567890123";
    const invocation = callTurnBroker(
      socketPath,
      {
        method: "invoke",
        bindingId: claimed.bindingId,
        callId,
        wireName: "never_settles",
        freeform: false,
        arguments: {},
      },
      null,
    );
    await broker.nextToolBatch(token);
    const invocationOutcome = invocation.then(
          value => ({ type: "value" as const, value }),
          error => ({ type: "error" as const, error: error instanceof Error ? error : new Error(String(error)) }),
        );
    const retirement = broker.waitForRetirement(token);
    await expect(callTurnBroker(socketPath, {
      method: "abandon_invoke",
      bindingId: claimed.bindingId,
      callId,
      failure: { code: "codex_tool_timeout", tool: "never_settles", timeoutMs: 90_000 },
    })).resolves.toEqual({ abandoned: true, delivered: true });
    const settledInvocation = await invocationOutcome;
        expect(settledInvocation.type).toBe("error");
        if (settledInvocation.type !== "error") throw new Error("abandoned invocation unexpectedly resolved");
        expect(settledInvocation.error.message).toContain("exceeded its MCP transport deadline");
    const failure = await retirement;
    expect(failure).toEqual({ code: "codex_tool_timeout", tool: "never_settles", timeoutMs: 90_000 });
    await expect(callTurnBroker(socketPath, { method: "claim", token }))
      .rejects.toThrow("already finished");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("timeout cleanup detects a native result that completed at the deadline boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-ar-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "trace_abandon_race");
    const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(
      socketPath,
      { method: "claim", token },
    );
    const callId = "call_completedAtBoundary123456789";
    const invocation = callTurnBroker(
      socketPath,
      {
        method: "invoke",
        bindingId: claimed.bindingId,
        callId,
        wireName: "side_effecting_tool",
        freeform: false,
        arguments: {},
      },
      null,
    );
    await broker.nextToolBatch(token);
    broker.completeTool(token, callId, {
      content: [{ type: "text", text: "completed" }],
    });
    await expect(invocation).resolves.toMatchObject({
      content: [{ type: "text", text: "completed" }],
    });

    await expect(callTurnBroker(socketPath, {
      method: "abandon_invoke",
      bindingId: claimed.bindingId,
      callId,
      failure: { code: "codex_tool_timeout", tool: "side_effecting_tool", timeoutMs: 90_000 },
    })).resolves.toEqual({ abandoned: false, delivered: true, completed: true });

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: claimed.activityId,
    });
    expect(broker.beginCompletionFence(token)).toEqual(expect.any(Number));
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an undelivered timed-out invocation is removed without poisoning the turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-aq-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "trace_abandon_queued");
    const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(
      socketPath,
      { method: "claim", token },
    );
    const callId = "call_abandonedQueued123456789012";
    const invocation = callTurnBroker(
      socketPath,
      {
        method: "invoke",
        bindingId: claimed.bindingId,
        callId,
        wireName: "slow_tool",
        freeform: false,
        arguments: {},
      },
      null,
    );

    const invocationOutcome = invocation.then(
          value => ({ type: "value" as const, value }),
          error => ({ type: "error" as const, error: error instanceof Error ? error : new Error(String(error)) }),
        );
    await expect(callTurnBroker(socketPath, {
      method: "abandon_invoke",
      bindingId: claimed.bindingId,
      callId,
      failure: { code: "codex_tool_timeout", tool: "slow_tool", timeoutMs: 90_000 },
    })).resolves.toEqual({ abandoned: true, delivered: false });
    const settledInvocation = await invocationOutcome;
        expect(settledInvocation.type).toBe("error");
        if (settledInvocation.type !== "error") throw new Error("abandoned invocation unexpectedly resolved");
        expect(settledInvocation.error.message).toContain("exceeded its MCP transport deadline");
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: claimed.activityId,
    });
    expect(broker.beginCompletionFence(token)).toEqual(expect.any(Number));

    const wait = new AbortController();
    const pendingBatch = broker.nextToolBatch(token, wait.signal);
    wait.abort();
    await expect(pendingBatch).rejects.toThrow("tool wait aborted");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
