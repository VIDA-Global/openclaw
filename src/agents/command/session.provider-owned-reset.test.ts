import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";

const hoisted = vi.hoisted(() => ({
  store: {} as Record<string, SessionEntry>,
}));

vi.mock("../../config/sessions/store-load.js", () => ({
  loadSessionStore: () => hoisted.store,
}));

vi.mock("../../config/sessions/paths.js", () => ({
  resolveStorePath: () => "/stores/main.json",
}));

const { clearRotatedSessionMetadata, resolveSession } = await import("./session.js");

const DAY_MS = 24 * 60 * 60 * 1000;

function seedProviderOwned(sessionKey: string): void {
  const startedAt = Date.now() - DAY_MS;
  hoisted.store = {
    [sessionKey]: {
      sessionId: "old-session-id",
      updatedAt: startedAt,
      sessionStartedAt: startedAt,
      lastInteractionAt: startedAt,
      model: "claude-opus-4-6",
      modelProvider: "claude-cli",
      cliSessionBindings: { "claude-cli": { sessionId: "cli-conversation-xyz" } },
    },
  };
}

describe("command resolveSession provider-owned daily reset", () => {
  it("keeps a provider-owned CLI session across the default daily boundary", () => {
    const sessionKey = "agent:main:cli";
    seedProviderOwned(sessionKey);

    const result = resolveSession({
      cfg: { session: {} } as OpenClawConfig,
      sessionKey,
      agentId: "main",
    });

    expect(result.isNewSession).toBe(false);
    expect(result.sessionId).toBe("old-session-id");
  });

  it("still rotates a non-provider-owned session across the daily boundary", () => {
    const sessionKey = "agent:main:cli";
    const startedAt = Date.now() - DAY_MS;
    hoisted.store = {
      [sessionKey]: {
        sessionId: "old-session-id",
        updatedAt: startedAt,
        sessionStartedAt: startedAt,
        lastInteractionAt: startedAt,
      },
    };

    const result = resolveSession({
      cfg: { session: {} } as OpenClawConfig,
      sessionKey,
      agentId: "main",
    });

    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe("old-session-id");
  });
});

describe("clearRotatedSessionMetadata", () => {
  it("removes lifecycle state inherited from the previous session", () => {
    const entry = clearRotatedSessionMetadata({
      sessionId: "old-session-id",
      updatedAt: 1,
      sessionStartedAt: 2,
      lastInteractionAt: 3,
      sessionFile: "/tmp/old-session.jsonl",
      status: "done",
      startedAt: 4,
      endedAt: 5,
      runtimeMs: 1,
      abortedLastRun: true,
    });

    expect(entry).toMatchObject({
      sessionId: "old-session-id",
      updatedAt: 1,
    });
    expect(entry.sessionStartedAt).toBeUndefined();
    expect(entry.lastInteractionAt).toBeUndefined();
    expect(entry.sessionFile).toBeUndefined();
    expect(entry.status).toBeUndefined();
    expect(entry.startedAt).toBeUndefined();
    expect(entry.endedAt).toBeUndefined();
    expect(entry.runtimeMs).toBeUndefined();
    expect(entry.abortedLastRun).toBeUndefined();
  });
});
