# VIDA OpenClaw Fork Update Plan

Date: 2026-06-29

Baseline reviewed: `vida-v2026.3.24`

Current upstream target reviewed: `v2026.6.10`

## Purpose

This document is the working checklist for updating VIDA's OpenClaw fork. It should drive the actual rebase implementation.

Assumptions for this update:

- OpenClaw will be rebased from the used VIDA baseline, `vida-v2026.3.24`, onto upstream `v2026.6.10`.
- `vida.live` backend behavior is unchanged.
- Plugins are unchanged.
- Provisioner changes are in scope.
- Provisioner must update newly written configs and migrate existing persisted configs during image upgrade.

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

## OpenClaw Fork Decisions

| Fork area/files | Decision | Reason |
| --- | --- | --- |
| `src/providers/vida-responses.ts` | Drop | Provisioner will convert generated and persisted configs to stock OpenAI-compatible provider config. |
| `src/providers/vida-responses-shared.ts` | Drop | Supports the removed custom provider. |
| `src/providers/vida-responses*.test.ts` | Drop | Tests only the removed provider. |
| `api: "vida-responses"` in model API enums/schemas | Drop | OpenClaw runtime config should no longer contain this API name. |
| Generated schema entries/tests for `vida-responses` | Drop | Same as above. |
| Runtime import/registration of `vida-responses` | Drop | Stock OpenAI-compatible provider adapters should handle outbound model calls to `vida.live`. |
| Hosted `/v1/responses` support in `src/gateway/openresponses-http.ts` and `src/gateway/open-responses.schema.ts` | Keep targeted VIDA patches | Current `vida.live` consumes hosted OpenResponses behavior that upstream does not fully provide. |
| Hosted Responses plumbing through agent command/run params | Keep targeted VIDA patches | Required for `provider_metadata`, reasoning callbacks, tool-result caps, and hosted client-tool behavior not already covered by upstream. |
| Hosted `/v1/responses` `clientTools` behavior | Keep behavior | VIDA sends function/tool options through `fetchResponse`; OpenClaw must expose them as client tools. Upstream `v2026.6.10` already covers the core path, so keep tests and avoid duplicate old fork code. |
| Output-side internal `function_call_output` items | Keep | Current `vida.live` operator retry/salvage/final payload behavior depends on delegated tool-result evidence from OpenClaw hosted responses. |
| Reasoning stream/final output with stable IDs | Keep | `vida.live` drops reasoning events without stable IDs and stores reasoning events for operator flows. |
| Inbound `provider_metadata` and relay metadata fallback | Keep | Current `vida.live` sends provider metadata and expects it to survive the hosted OpenResponses hop. |
| `toolResultMaxDataBytes` and binary/base64 tool-result sanitization | Keep | Current fork uses this to bound hosted tool-result payloads. |
| Plugin-owned Vida OpenAI request attribution | Keep | `memory-lancedb-pro` still creates its own OpenAI-compatible embedding and smart-extraction clients, bypassing normal model provider config. |
| AsyncLocalStorage/global fetch attribution wrapper | Keep | Needed to add `x-openclaw-agent-id` and `x-openclaw-session-key` to plugin-owned `${VIDA_API_BASE_URL}/openai/v1/*` requests. |
| `onBlockReply` synchronous dispatch change | Drop | No concrete dependency was found for changing upstream callback scheduling. |
| Browser reliability patches | Drop broad patch | Upstream browser internals changed heavily after March. Validate browser flows after rebase and only add focused fixes for reproduced failures. |
| WhatsApp browser identity and nested disconnect status extraction | Keep | VIDA-specific operational defaults/status handling. |
| Release sync scripts/docs | Keep | Fork operations tooling. |
| README VIDA fork delta section | Keep/update | Should match the final rebase decisions. |

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
2. Update provisioner generated-config normalization for stock OpenAI-compatible VIDA providers.
3. Add provisioner image-upgrade migration for persisted configs containing `api: "vida-responses"`.
4. Remove `vida-responses` provider/schema/runtime registration from OpenClaw.
5. Reapply hosted `/v1/responses` compatibility patches listed above.
6. Keep plugin-owned Vida OpenAI request attribution.
7. Drop `onBlockReply` synchronous dispatch change.
8. Drop broad browser reliability patches, then smoke test and re-add only narrow failures.
9. Keep WhatsApp VIDA-specific patches.
10. Keep release workflow docs/scripts and update README fork deltas.

## Validation Checklist

- Generated provisioner config contains no `api: "vida-responses"`.
- Upgraded persisted configs are migrated before OpenClaw starts.
- Multi-agent gateway config keeps one stock provider per agent ID.
- Outbound model calls to `${VIDA_API_BASE_URL}/openai/v1` include `x-vida-account-id` and `x-openclaw-agent-id`.
- Hosted `/v1/responses` accepts `provider_metadata`.
- Hosted `/v1/responses` accepts `reasoning.effort` and `reasoning.summary`.
- Hosted `/v1/responses` emits stable reasoning IDs.
- Hosted `/v1/responses` emits internal `function_call` and `function_call_output` output items/events needed by current `vida.live`.
- Hosted client tools from `tools` / `tool_choice` flow into embedded execution and return `function_call` output items.
- Plugin-owned Vida OpenAI requests receive `x-openclaw-agent-id` and `x-openclaw-session-key`.
- WhatsApp VIDA-specific defaults still pass existing tests.
- Browser smoke tests pass on upstream `v2026.6.10` baseline plus remaining VIDA patches.
