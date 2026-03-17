---
title: "Plugin Request Attribution"
summary: "VIDA-specific request attribution for plugin-owned OpenAI-compatible traffic"
---

# Plugin Request Attribution

This fork adds a small VIDA-specific runtime layer so plugin-owned OpenAI-compatible
requests can be attributed back to the active OpenClaw agent and session.

## Why this exists

Some plugins, notably `memory-lancedb-pro`, create their own OpenAI SDK clients for
internal `chat/completions` and `embeddings` calls.

That bypasses OpenClaw's normal provider abstraction, which means provider-layer
customization cannot attach per-agent attribution headers for billing and audit.

VIDA needs those requests to carry:

- `x-openclaw-agent-id`
- `x-openclaw-session-key`

so the backend can attribute usage to the correct deployed agent.

## Why this fork patch is intentionally small

OpenClaw upstream changes frequently, so this fork keeps the surface area narrow:

- a tiny AsyncLocalStorage scope for `agentId` / `sessionKey`
- a narrowly targeted global `fetch` wrapper
- hook-runner wiring so plugin async hooks run inside that scope

The wrapper only touches requests under:

- `${VIDA_API_BASE_URL}/openai/v1`

and only injects headers when a plugin hook has established an attribution scope.

This avoids touching:

- provider implementations
- model resolution
- gateway OpenAI handler logic
- third-party plugin source code

## Current scope

This patch is intended to cover automatic plugin traffic triggered from async hooks,
which is the important path for `memory-lancedb-pro` auto-recall and auto-capture.

If future VIDA features require per-agent attribution for plugin tool executions too,
that can be added later as a separate patch without changing this design.
