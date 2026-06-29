# VIDA OpenClaw Fork Update Plan

Date: 2026-06-29

Baseline reviewed: `vida-v2026.3.24`

Current upstream target reviewed: `v2026.6.10`

## Purpose

This document is the working checklist for updating VIDA's OpenClaw fork. It should drive the actual rebase implementation.

Assumptions for this update:

- OpenClaw will be rebased from the used VIDA baseline, `vida-v2026.3.24`, onto upstream `v2026.6.10`.
- `vida.live` backend behavior is unchanged.
- VIDA backend/plugin behavior is unchanged, but managed memory/context plugin package versions in `openclaw-docker` must be updated for the new OpenClaw baseline.
- Provisioner changes are in scope.
- Provisioner must update newly written configs and migrate existing persisted configs during image upgrade.
- `openclaw-docker` changes are in scope because the VIDA image builds OpenClaw from source and does not inherit upstream OpenClaw's published Docker image.

Primary outcome:

- remove the custom `vida-responses` OpenClaw provider from the fork;
- keep current `vida.live` hosted `/v1/responses` compatibility;
- keep plugin-owned Vida OpenAI request attribution;
- drop fork patches that latest upstream already covers or that have no concrete dependency.

## Required Provisioner Changes

These provisioner changes are required for the OpenClaw fork to remove `vida-responses`.

Provisioner must:

- rewrite all generated `api: "vida-responses"` provider/model entries to `openai-responses`;
- preserve one provider per agent ID for multi-agent gateways;
- add both `x-vida-account-id` and `x-openclaw-agent-id` headers;
- preserve existing auth/base URL behavior for `${VIDA_API_BASE_URL}/openai/v1`;
- migrate persisted legacy configs during image upgrade;
- repair or reject runtime config before OpenClaw starts if it still contains `api: "vida-responses"`.
- update managed `lossless-claw` config from old aliases to current preferred keys:
  - use `databasePath` instead of `dbPath`;
  - use `sweepMaxDepth` instead of `incrementalMaxDepth`;
- keep explicit `memory-lancedb-pro` `embedding` and `llm` config pointing at `${VIDA_API_BASE_URL}/openai/v1`; current plugin main still creates its own OpenAI-compatible clients and does not delegate to OpenClaw `models.providers`.

Expected per-agent provider shape:

```json
{
  "models": {
    "providers": {
      "vida-2301795": {
        "api": "openai-responses",
        "baseUrl": "${VIDA_API_BASE_URL}/openai/v1",
        "auth": "api-key",
        "authHeader": true,
        "apiKey": "${OPENCLAW_GATEWAY_TOKEN}",
        "headers": {
          "x-vida-account-id": "2301795",
          "x-openclaw-agent-id": "2301795"
        },
        "models": [
          {
            "id": "agent-model",
            "name": "agent-model",
            "api": "openai-responses",
            "reasoning": true,
            "input": ["text"]
          }
        ]
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "2301795",
        "model": "vida-2301795/agent-model"
      }
    ]
  }
}
```

## Required openclaw-docker Changes

These image changes are required to build and run the rebased OpenClaw correctly in VIDA-managed containers.

`openclaw-docker` is not based on an upstream OpenClaw image. It starts from Node, clones `OPENCLAW_GIT_URL`/`OPENCLAW_GIT_REF`, builds OpenClaw source, and layers VIDA runtime/browser/plugin behavior. Upstream Dockerfile changes must therefore be pulled in manually where they affect the source build or runtime assumptions.

Required image updates:

- update the OpenClaw build base from floating `node:22-bookworm` to a pinned base that satisfies upstream `v2026.6.10` `engines.node >=22.19.0`; matching upstream's Node 24 base is the preferred path;
- use the checked-out OpenClaw ref's `pnpm build:docker` instead of manually reconstructing the old March build sequence;
- keep VIDA-specific postbuild steps only after `pnpm build:docker`;
- run install/build with the checked-out OpenClaw ref's package manager, currently `pnpm@11.2.2+sha512...` at `v2026.6.10`;
- adopt upstream Docker install flags for native/optional dependency consistency:
  - `NODE_OPTIONS=--max-old-space-size=2048`;
  - `--config.supportedArchitectures.os=linux`;
  - `--config.supportedArchitectures.cpu="$(node -p 'process.arch')"`;
  - `--config.supportedArchitectures.libc=glibc`;
- add runtime utilities expected by upstream image/runtime paths that are currently missing from VIDA's explicit apt list:
  - `hostname`;
  - `lsof`;
  - `openssl`;
  - `tini`;
- run the container entrypoint under `tini` or otherwise preserve equivalent signal forwarding and child-process reaping for the gateway/browser processes.

Managed plugin package updates:

- update `@martian-engineering/lossless-claw` from `0.3.0` to `0.13.1`;
- verify the bundled `lossless-claw` package has:
  - `openclaw.plugin.json`;
  - `dist/index.js`;
- replace npm `memory-lancedb-pro@1.1.0-beta.9` with a pinned GitHub main commit because npm releases are stale for the new OpenClaw baseline:
  - repository: `https://github.com/CortexReach/memory-lancedb-pro.git`;
  - commit reviewed: `1f44e05caeca45c00531cef366bac8521ddad2e3`;
  - package version at that commit: `1.1.0-beta.11`;
- install `memory-lancedb-pro` via `npm pack github:CortexReach/memory-lancedb-pro#<commit>` followed by `npm install -g ./memory-lancedb-pro-*.tgz --omit=dev`;
- do not use direct global GitHub install for `memory-lancedb-pro`; it failed with npm status `236` / `ENOTDIR` during validation;
- verify the bundled `memory-lancedb-pro` package has:
  - `openclaw.plugin.json`;
  - `dist/index.js`.

Browser runtime update:

- VIDA's default browser path uses `openclaw-docker/scripts/browser-lazy-supervisor.mjs`, not upstream `scripts/sandbox-browser-entrypoint.sh`;
- upstream `v2026.6.10` added CDP relay hardening to `sandbox-browser-entrypoint.sh`, including `OPENCLAW_BROWSER_CDP_AUTH_TOKEN`, port validation, cleanup traps, and authenticated relay behavior;
- reconcile that hardening with VIDA's lazy supervisor before release; validate that provisioner/router auth prevents unauthenticated external CDP access, and port upstream token-relay behavior if it does not;
- keep the legacy `OPENCLAW_BROWSER_LAZY_START=0` path compatible with the new upstream `sandbox-browser-entrypoint.sh` if that path remains supported.

## OpenClaw Fork Decisions

| Fork area/files                                                                                                  | Decision                   | Reason                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/vida-responses.ts`                                                                                | Drop                       | Provisioner will convert generated and persisted configs to stock OpenAI-compatible provider config.                                                                                                      |
| `src/providers/vida-responses-shared.ts`                                                                         | Drop                       | Supports the removed custom provider.                                                                                                                                                                     |
| `src/providers/vida-responses*.test.ts`                                                                          | Drop                       | Tests only the removed provider.                                                                                                                                                                          |
| `api: "vida-responses"` in model API enums/schemas                                                               | Drop                       | OpenClaw runtime config should no longer contain this API name.                                                                                                                                           |
| Generated schema entries/tests for `vida-responses`                                                              | Drop                       | Same as above.                                                                                                                                                                                            |
| Runtime import/registration of `vida-responses`                                                                  | Drop                       | Stock OpenAI-compatible provider adapters should handle outbound model calls to `vida.live`.                                                                                                              |
| Hosted `/v1/responses` support in `src/gateway/openresponses-http.ts` and `src/gateway/open-responses.schema.ts` | Keep targeted VIDA patches | Current `vida.live` consumes hosted OpenResponses behavior that upstream does not fully provide.                                                                                                          |
| Hosted Responses plumbing through agent command/run params                                                       | Keep targeted VIDA patches | Required for `provider_metadata`, reasoning callbacks, tool-result caps, and hosted client-tool behavior not already covered by upstream.                                                                 |
| Hosted `/v1/responses` `clientTools` behavior                                                                    | Keep behavior              | VIDA sends function/tool options through `fetchResponse`; OpenClaw must expose them as client tools. Upstream `v2026.6.10` already covers the core path, so keep tests and avoid duplicate old fork code. |
| Output-side internal `function_call_output` items                                                                | Keep                       | Current `vida.live` operator retry/salvage/final payload behavior depends on delegated tool-result evidence from OpenClaw hosted responses.                                                               |
| Reasoning stream/final output with stable IDs                                                                    | Keep                       | `vida.live` drops reasoning events without stable IDs and stores reasoning events for operator flows.                                                                                                     |
| Inbound `provider_metadata` and relay metadata fallback                                                          | Keep                       | Current `vida.live` sends provider metadata and expects it to survive the hosted OpenResponses hop.                                                                                                       |
| `toolResultMaxDataBytes` and binary/base64 tool-result sanitization                                              | Keep                       | Current fork uses this to bound hosted tool-result payloads.                                                                                                                                              |
| Plugin-owned Vida OpenAI request attribution                                                                     | Keep                       | `memory-lancedb-pro` still creates its own OpenAI-compatible embedding and smart-extraction clients, bypassing normal model provider config.                                                              |
| AsyncLocalStorage/global fetch attribution wrapper                                                               | Keep                       | Needed to add `x-openclaw-agent-id` and `x-openclaw-session-key` to plugin-owned `${VIDA_API_BASE_URL}/openai/v1/*` requests.                                                                             |
| `onBlockReply` synchronous dispatch change                                                                       | Drop                       | No concrete dependency was found for changing upstream callback scheduling.                                                                                                                               |
| Browser reliability patches                                                                                      | Drop broad patch           | Upstream browser internals changed heavily after March. Validate browser flows after rebase and only add focused fixes for reproduced failures.                                                           |
| WhatsApp browser identity and nested disconnect status extraction                                                | Keep                       | VIDA-specific operational defaults/status handling.                                                                                                                                                       |
| Release sync scripts/docs                                                                                        | Keep                       | Fork operations tooling.                                                                                                                                                                                  |
| README VIDA fork delta section                                                                                   | Keep/update                | Should match the final rebase decisions.                                                                                                                                                                  |

## Hosted OpenResponses Implementation Notes

Carry these as small patches on top of upstream `v2026.6.10`, not as a wholesale port of the old fork file:

- accept and forward inbound `provider_metadata`;
- preserve `metadata["vida.ignoreOnProviderRelay"] === "true"` as `{ vida: { ignoreOnProviderRelay: true } }`;
- accept inbound `reasoning.effort` and `reasoning.summary`;
- map hosted reasoning into streamed/final OpenResponses reasoning output with stable IDs;
- decide and implement whether `reasoning.effort` changes OpenClaw thinking depth, because current `vida.live` sends operator `thinkingEffort`;
- preserve `reasoning.summary` placement in emitted reasoning items;
- keep `onReasoningStream` callback plumbing;
- keep internal OpenClaw tool-call output as `function_call` items/events;
- keep internal OpenClaw tool-result output as `function_call_output` items/events;
- keep request-input `function_call_output` for client-tool continuation;
- keep `toolResultMaxDataBytes` handling;
- keep binary/base64 tool-result sanitization;
- keep transcript/provider metadata preservation needed by hosted-run relay behavior;
- keep safe stringification for non-string or non-JSON tool outputs;
- keep usage and finish metadata in hosted responses.

Implementation evidence:

- `vida.live/lib/openAiHelper.js` routes OpenClaw-hosted requests through `modelFetch = "openclaw:router"`.
- `vida.live` uses `@vida-global/openclaw-ai-sdk-provider@0.2.0` for OpenClaw gateway `/v1/responses`.
- `buildOpenClawProviderOptions(...)` sends `providerOptions.openclaw.sessionKey`, `providerOptions.openclaw.agentId`, `metadata["vida.ignoreOnProviderRelay"] = "true"`, and `providerMetadata.vida.ignoreOnProviderRelay = true`.
- Delegated operator calls can send `providerMetadata.vida.reasoningEffort` from operator `thinkingEffort`.
- `OAIStreamResponseAdapter` extracts `toolEvent` and `reasoningEvent`.
- `operatorService.js` stores tool and reasoning events in `callMeta.toolEvents` and `callMeta.reasoningEvents`.
- `eventTracker.js` drops reasoning events without an `id`.
- `OAIResponseMessageInjectionStage` reads raw `response.body.output[]` to recover `function_call_output` payloads.

## Hosted Client Tools

This behavior is required.

VIDA sends function/tool options through `fetchResponse` and OpenAI-compatible controller paths:

- `vida.live/lib/openAiHelper.js` builds `completionDict.functions` and sets `function_call = "auto"`.
- `vida.live/lib/models/OAIRequestAdapter.js` converts OpenAI-style `functions` into AI SDK `tools` and `toolChoice`.
- `vida.live/lib/controllers/openai/v1/responsesController.js` and `chat/completionsController.js` pass `tools` and `toolChoice` to model execution.

OpenClaw hosted `/v1/responses` must pass those tools into embedded execution and return model-selected client tool calls as `function_call` output items.

Upstream `v2026.6.10` already has the core implementation:

- extracts `body.tools`;
- applies `tool_choice`;
- passes `clientTools` into `agentCommandFromIngress`;
- returns pending client tool calls as `function_call` output items.

Keep regression coverage for this behavior, but do not re-port old VIDA client-tool forwarding code where upstream already provides the same behavior.

## Plugin Request Attribution

Keep this in the OpenClaw fork for this update.

Current `memory-lancedb-pro` main branch, checked at `1f44e05caeca45c00531cef366bac8521ddad2e3`, still creates its own clients for:

- embeddings in `src/embedder.ts`;
- smart-extraction LLM calls in `src/llm-client.ts`.

The plugin manifest still exposes plugin-local `embedding.apiKey`, `embedding.baseURL`, `embedding.model`, `llm.apiKey`, `llm.baseURL`, `llm.model`, and `llm.auth`. No support was found for delegating those plugin-owned requests to OpenClaw `models.providers`.

Therefore OpenClaw still needs request attribution around plugin hooks so plugin-owned Vida OpenAI traffic carries:

- `x-openclaw-agent-id`;
- `x-openclaw-session-key`.

Implementation evidence:

- Current `memory-lancedb-pro` main branch checked at `1f44e05caeca45c00531cef366bac8521ddad2e3`.
- Embedding client construction is in `src/embedder.ts`.
- Smart-extraction LLM client construction is in `src/llm-client.ts`.
- Manifest still exposes plugin-local `embedding.apiKey`, `embedding.baseURL`, `embedding.model`, `llm.apiKey`, `llm.baseURL`, `llm.model`, and `llm.auth`.

## Rebase Order

1. Start from upstream `v2026.6.10`.
2. Update `openclaw-docker` so it can build the rebased OpenClaw ref with the new Node/package-manager/build assumptions.
3. Update `openclaw-docker` managed plugin packages: `lossless-claw@0.13.1` and pinned `memory-lancedb-pro` main.
4. Update provisioner generated-config normalization for stock OpenAI-compatible VIDA providers.
5. Update provisioner managed plugin config for current `lossless-claw` and `memory-lancedb-pro`.
6. Add provisioner image-upgrade migration for persisted configs containing `api: "vida-responses"` and old managed-plugin config aliases.
7. Remove `vida-responses` provider/schema/runtime registration from OpenClaw.
8. Reapply hosted `/v1/responses` compatibility patches listed above.
9. Keep plugin-owned Vida OpenAI request attribution.
10. Drop `onBlockReply` synchronous dispatch change.
11. Drop broad browser reliability patches, then smoke test and re-add only narrow failures.
12. Keep WhatsApp VIDA-specific patches.
13. Keep release workflow docs/scripts and update README fork deltas.

## Validation Checklist

- Generated provisioner config contains no `api: "vida-responses"`.
- Upgraded persisted configs are migrated before OpenClaw starts.
- Multi-agent gateway config keeps one stock provider per agent ID.
- Provisioner-generated `lossless-claw` config uses `databasePath` and `sweepMaxDepth`.
- Provisioner-generated `memory-lancedb-pro` config keeps explicit `embedding` and `llm` Vida OpenAI-compatible settings.
- `openclaw-docker` builds the rebased OpenClaw ref with `pnpm build:docker`.
- `openclaw-docker` runtime Node version satisfies the rebased OpenClaw `engines.node`.
- Bundled `/app/extensions/lossless-claw` contains `openclaw.plugin.json` and `dist/index.js`.
- Bundled `/app/extensions/memory-lancedb-pro` contains `openclaw.plugin.json` and `dist/index.js`.
- Outbound model calls to `${VIDA_API_BASE_URL}/openai/v1` include `x-vida-account-id` and `x-openclaw-agent-id`.
- Hosted `/v1/responses` accepts `provider_metadata`.
- Hosted `/v1/responses` accepts `reasoning.effort` and `reasoning.summary`.
- Hosted `/v1/responses` emits stable reasoning IDs.
- Hosted `/v1/responses` emits internal `function_call` and `function_call_output` output items/events needed by current `vida.live`.
- Hosted client tools from `tools` / `tool_choice` flow into embedded execution and return `function_call` output items.
- Plugin-owned Vida OpenAI requests receive `x-openclaw-agent-id` and `x-openclaw-session-key`.
- WhatsApp VIDA-specific defaults still pass existing tests.
- Browser smoke tests pass on upstream `v2026.6.10` baseline plus remaining VIDA patches.
- Browser CDP/noVNC exposure remains protected after reconciling upstream `sandbox-browser-entrypoint.sh` hardening with VIDA's `browser-lazy-supervisor.mjs`.
