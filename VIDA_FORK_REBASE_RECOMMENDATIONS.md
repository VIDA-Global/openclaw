# VIDA OpenClaw Fork Rebase Recommendations

Date: 2026-06-29

Baseline reviewed: `vida-v2026.3.24`

Current upstream target reviewed: `v2026.6.10`

## Summary

Under the current working assumption, this is an OpenClaw fork update plus provisioner changes if needed. Do not assume `vida.live` backend or plugin changes.

With that constraint, the fork can still be reduced, especially where upstream `v2026.6.10` already has equivalent behavior. The large `vida-responses` removal is viable only if the provisioner guarantees the actual config reaching OpenClaw no longer references `api: "vida-responses"` and includes the attribution headers needed by `vida.live`.

The main behavior that must not be lost is request attribution. `vida.live` needs to know which agent/account a request belongs to, especially on gateways hosting multiple agent IDs.

Important distinction:

- `vida-responses` is an OpenClaw fork provider for outbound OpenClaw model calls to `vida.live`. It still looks removable in a future migration, but only after the deployed runtime config path is confirmed to use stock OpenAI-compatible provider APIs instead.
- `@vida-global/openclaw-ai-sdk-provider` is a `vida.live` dependency for inbound `vida.live` calls to an OpenClaw gateway `/v1/responses`. Do not assume it can be deleted as part of the OpenClaw rebase. The OpenClaw fork must remain compatible with it.

For this OpenClaw + provisioner update, keep these compatibility behaviors unless direct rebase tests prove upstream has the exact equivalent:

- `vida-responses` provider/schema/runtime support if OpenClaw can still receive configs with `api: "vida-responses"` after provisioner normalization;
- hosted `/v1/responses` support consumed by `vida.live`: `provider_metadata`, `reasoning.effort` / `reasoning.summary`, stable reasoning IDs, streamed/final `function_call` events, streamed/final `function_call_output` tool-result items, usage/finish metadata, and current tool-result size/sanitization semantics;
- plugin-owned Vida OpenAI request attribution with `x-openclaw-agent-id` and `x-openclaw-session-key`;
- custom-provider compatibility for `@vida-global/openclaw-ai-sdk-provider@0.2.0`.

## Future Replacement For `vida-responses`

This section describes the likely simplification target. It is safe only if the provisioner or existing deployed config path produces this shape before OpenClaw reads config.

Instead of a custom OpenClaw provider API named `vida-responses`, generate one stock OpenAI-compatible provider per agent.

Example per-agent provider config:

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

`openai-completions` may also work if that remains the desired compatibility surface for a specific path, but the important point is that `vida-responses` should not be needed as a custom OpenClaw API adapter after the downstream config path is migrated or validated.

Current caution: `vida.live/lib/openclaw/llmConfig.js` still emits `api: "vida-responses"` and `x-vida-account-id`. Since provisioner changes are allowed, the practical target is to normalize this before writing OpenClaw config: rewrite to a stock OpenAI-compatible API such as `openai-responses` or `openai-completions`, set the correct VIDA/OpenClaw headers, and prove the resulting runtime config never contains `vida-responses`.

## `vida.live` Hosted OpenResponses Consumer Audit

`vida.live` currently consumes OpenClaw hosted `/v1/responses` through `@vida-global/openclaw-ai-sdk-provider@0.2.0`, not through the stock `@ai-sdk/openai` provider.

Actual request path:

- `lib/openAiHelper.js` routes OpenClaw-hosted requests through `modelFetch = "openclaw:router"`.
- `resolveOpenClawGateway(...)` selects the per-agent gateway and auth token.
- `VercelModelProviderFactory` creates the custom `openclaw` provider from `@vida-global/openclaw-ai-sdk-provider`.
- `buildOpenClawProviderOptions(...)` sends `providerOptions.openclaw.sessionKey`, `providerOptions.openclaw.agentId`, `metadata["vida.ignoreOnProviderRelay"] = "true"`, and `providerMetadata.vida.ignoreOnProviderRelay = true`.
- Delegated operator calls can additionally send `providerMetadata.vida.reasoningEffort`, derived from operator `thinkingEffort`.

Actual stream/final consumers:

- Streaming OpenClaw responses are read with `includeRawChunks: true`.
- `OAIStreamResponseAdapter` extracts `toolEvent` and `reasoningEvent` side channels.
- `operatorService.js` stores these in `callMeta.toolEvents` and `callMeta.reasoningEvents` for progress updates and delegated result payloads.
- `eventTracker.js` drops reasoning events without an `id`, so OpenClaw reasoning events must have stable IDs.
- Non-stream responses are adapted by `OAIResponseMessageInjectionStage`, which consumes `toolEvents` and `reasoningEvents`.
- That same stage also reads raw `response.body.output[]` to recover `function_call_output` payloads for final tool-result output.

This means the hosted OpenResponses fork work is not only API parity. `vida.live` currently depends on these concrete behaviors:

- inbound `provider_metadata` accepted by OpenClaw and available to downstream model relay logic;
- inbound `reasoning.effort` and `reasoning.summary` accepted by OpenClaw;
- reasoning stream/final output with stable item IDs;
- streamed internal OpenClaw tool calls as `function_call` output items/events;
- streamed/final internal OpenClaw tool results as `function_call_output` output items/events, unless `vida.live` gets a replacement tool-result event source;
- usage/finish metadata in the OpenResponses-compatible response.

Important split:

- Accepting `function_call_output` as request input is standard Responses-style client-tool continuation and should remain supported. Upstream already has substantial support for this.
- Emitting `function_call_output` as response output for OpenClaw-internal tool execution is also represented in current generated OpenAI SDK response-output types. However, upstream OpenClaw `v2026.6.10` does not emit it, and `@ai-sdk/openai` currently does not parse it as a response output item.
- VIDA uses these output-side tool-result items for more than UI progress: operator retry decisions, salvage of non-JSON delegated output, final `delegatedToolCalls` payloads, async terminal function args, and voice operator context all depend on `callMeta.toolEvents`.

If VIDA is willing to change `vida.live`, this may still be removable from the OpenClaw fork. But it needs a real replacement path or an explicit decision to give up those operator behaviors. Candidate replacements:

- keep a small custom or patched AI SDK provider that maps `function_call_output` response output items to `tool-result` parts;
- add a separate OpenClaw-specific tool event stream/channel consumed by `vida.live`;
- refactor operator runtime to rely only on final assistant JSON and stop using delegated tool evidence for retry/salvage/final payloads.

### Can `@vida-global/openclaw-ai-sdk-provider` Be Removed?

Probably yes in a future `vida.live` migration, but not as a pure OpenClaw fork simplification.

The installed `@ai-sdk/openai` package already has `openai.responses(modelId)` with configurable `baseURL`, static headers, and custom `fetch`. In principle, `vida.live` could point stock `openai.responses("openclaw:router")` at the OpenClaw gateway instead of using `@vida-global/openclaw-ai-sdk-provider`.

However, a direct replacement is not currently equivalent:

- Stock `@ai-sdk/openai` reads `providerOptions.openai`, while `vida.live` writes `providerOptions.openclaw`.
- The stock provider will not automatically add `x-openclaw-session-key` and `x-openclaw-agent-id` from `providerOptions.openclaw`.
- Reasoning options need to be mapped to `providerOptions.openai.reasoningEffort` / `reasoningSummary`, likely with `forceReasoning: true` for `openclaw:router`.
- Stock stream parsing does not accept `function_call_output` as a streamed `response.output_item.done` item.
- Stock final response validation also does not include `function_call_output` in `output[]`, even though current generated OpenAI SDK types include it.
- Stock provider metadata keys would be `openai` or the configured OpenAI provider name, not `openclaw.responses`, so `resolveReasoningEventId(...)` and related helper code need adjustment.

Recommendation for this rebase: keep OpenClaw compatible with this package.

Track removal as a downstream `vida.live` migration. The custom package can likely be deleted after either:

- `vida.live` adapts stock `@ai-sdk/openai` to preserve the current `function_call_output` and reasoning side-channel behavior; or
- OpenClaw changes its hosted `/v1/responses` output to omit internal tool-result output items, and VIDA replaces or intentionally drops the current delegated-tool evidence dependency.

Until that migration is done, OpenClaw should keep the hosted OpenResponses behaviors consumed by the custom provider package.

## Completeness Audit Against `vida-v2026.3.24`

This table reconciles the recommendation set against every file changed by:

```sh
git diff --name-status v2026.3.24...vida-v2026.3.24
```

| Fork area/files                                                                                                                                             | Behavior in fork                                                                                                                                                                                                                 | Current recommendation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                                                                 | Documents VIDA deltas and historical fork-only commits.                                                                                                                                                                          | Keep/update after rebase.                                                                                                                                                                                                                 |
| `scripts/README.vida-release-sync.md`, `scripts/sync-upstream-main.sh`, `scripts/sync-upstream-release.sh`, `scripts/verify-vida-release.sh`                | Fork release sync workflow, fork tag creation, Docker ref/date-tag verification, Codex conflict handoff files.                                                                                                                   | Keep. This is fork operations tooling, not upstream product behavior.                                                                                                                                                                     |
| `src/providers/vida-responses.ts`, `src/providers/vida-responses-shared.ts`, provider tests                                                                 | Custom OpenAI Responses-like provider adapter, OpenAI client resolution, Responses message/tool conversion, stream parsing, malformed function-call JSON tolerance, relay metadata/reasoning mapping.                            | Drop only if the provisioner normalizes generated runtime config so OpenClaw never receives `api: "vida-responses"`. Otherwise keep for compatibility.                                                                                    |
| `src/config/types.models.ts`, `src/config/types.gateway.ts`, `src/config/schema.base.generated.ts`, `src/config/zod-schema.ts`, `src/config/schema.test.ts` | Adds `vida-responses` to the canonical model API enum/schema. Adds `gateway.http.endpoints.responses.toolResultMaxDataBytes`.                                                                                                    | Drop `vida-responses` schema entries only if provisioner normalization is guaranteed. Keep `toolResultMaxDataBytes` if hosted Responses tool-output cap remains required.                                                                 |
| `src/gateway/openresponses-http.ts`, `src/gateway/open-responses.schema.ts`, OpenResponses tests                                                            | Hosted `/v1/responses` parity: inbound `provider_metadata`, inbound `reasoning`, emitted reasoning items, tool-call output items, internal tool-result output items, `toolResultMaxDataBytes`, fallback metadata relay flag. | Partially keep unless `vida.live` is changed. Rebase as small targeted patches on top of upstream `v2026.6.10`, because upstream has already absorbed some generic client-tool/Responses work.                                            |
| `src/agents/agent-command.ts`, `src/agents/command/types.ts`, `src/agents/pi-embedded-runner/run*.ts`, `src/commands/agent.vida-forwarding.test.ts`         | Plumbs `reasoningLevel`, `providerMetadata`, `toolResultMaxDataBytes`, `onReasoningStream`, and `clientTools` from hosted ingress into embedded execution. Imports/registers `vida-responses`.                                   | Keep hosted Responses plumbing still missing upstream. Drop `vida-responses` registration/import only after provisioner normalization proof. `clientTools` behavior is required, but upstream `v2026.6.10` already includes the core path. |
| `src/agents/pi-embedded-subscribe*`, `src/agents/session-tool-result-guard-wrapper.ts`, related tests                                                       | Emits/sanitizes tool results, enforces base64 `data` byte cap, persists provider metadata to transcript messages, and changes `onBlockReply` callback dispatch to direct sync invocation with sync/async error handling.         | Partially keep. Tool-result cap/metadata persistence are conditional on hosted Responses requirements. The `onBlockReply` dispatch change is a separate small decision item and should be tested against latest upstream before carrying. |
| `src/plugins/hook-runner-global.ts`, `src/plugins/hooks.ts`, `src/plugins/runtime/request-attribution-*`, attribution tests                                 | AsyncLocalStorage scope around plugin hooks; global `fetch` wrapper adds `x-openclaw-agent-id` and `x-openclaw-session-key` only for `${VIDA_API_BASE_URL}/openai/v1/*` plugin-owned requests.                                   | Keep in this rebase. Future rehome to `vida-openclaw-plugin` is possible, but not without plugin changes.                                                                                                                                 |
| `src/browser/client-fetch.ts`, `src/browser/client.ts`, browser tests                                                                                       | Browser error classification, action-path bounded retry guidance, 10s read/status timeouts, one retry after timeout-like read failure.                                                                                           | Try dropping first, because browser code changed heavily upstream. Re-add only a narrow patch if smoke tests reproduce the old failure.                                                                                                   |
| `extensions/whatsapp/src/session.ts`, `extensions/whatsapp/src/session-errors.ts`, WhatsApp tests                                                           | Uses `["Vida Operator", "web", VERSION]` WhatsApp browser identity and extracts nested `lastDisconnect.error.output.statusCode`.                                                                                                 | Keep if WhatsApp remains a VIDA-supported channel and upstream still lacks these exact behaviors.                                                                                                                                         |

### Future Drop Candidates, Not OpenClaw-Only Defaults

| Change                                                  | Decision | Reason                                                                                                                 |
| ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/providers/vida-responses.ts`                       | Drop with provisioner proof | Standard OpenAI-compatible provider config should route model calls through `vida.live`; provisioner can perform the config migration before OpenClaw sees it.                      |
| `src/providers/vida-responses-shared.ts`                | Drop with provisioner proof | Mostly supports the custom provider. Re-evaluate only if a specific parser is still needed for hosted `/v1/responses`.                                                              |
| `src/providers/vida-responses*.test.ts`                 | Drop with provisioner proof | Goes with provider removal.                                                                                                                                                         |
| `api: "vida-responses"` in `src/config/types.models.ts` | Drop with provisioner proof | Not needed once generated config uses `openai-responses` or `openai-completions`.                                                                                                   |
| Generated schema entries for `vida-responses`           | Drop with provisioner proof | Same reason.                                                                                                                                                                        |
| Config schema tests for `vida-responses`                | Drop with provisioner proof | Same reason.                                                                                                                                                                        |
| Import/registration of `vida-responses` in the runner   | Drop with provisioner proof | Stock OpenAI-compatible provider adapter should be used instead after provisioner config migration/validation.                                                                       |

Apply this table in the provisioner, not in `vida.live`.

### Provisioner Work Required Before Dropping `vida-responses`

| Behavior                                   | Decision               | Reason                                                                                      |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------- |
| One provider per agent ID                  | Keep in generated runtime config | Multi-agent gateways require per-agent account/agent attribution.                           |
| `vida.live` OpenClaw LLM config generation | Leave unchanged for this update | It currently emits legacy `vida-responses`; do not require backend changes for this rebase. |
| Provisioner legacy config normalization    | Keep/update in provisioner      | Rewrite `vida-responses` to stock OpenAI-compatible config and inject both attribution headers before OpenClaw reads config. |

Current integration issue: `vida.live/lib/openclaw/llmConfig.js` emits `api: "vida-responses"` and adds `x-vida-account-id`. If the backend is not changed, the provisioner must rewrite the API and add `x-openclaw-agent-id` before OpenClaw starts.

### Keep Or Rehome, But Do Not Drop Behavior

| Change                                                                                        | Decision                               | Reason                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Plugin-owned request attribution (`src/plugins/runtime/request-attribution-*`)                | Keep in OpenClaw for this update       | Plugin-created OpenAI clients/fetch calls bypass normal model provider config. |
| `x-openclaw-agent-id` / `x-openclaw-session-key` injection for plugin-owned Vida OpenAI calls | Keep behavior                          | Required for correct attribution in multi-agent gateways.                      |

This remains important even if model provider config is fixed, because plugin lifecycle hooks can create their own SDK clients or direct fetches to `${VIDA_API_BASE_URL}/openai/v1`.

Current `memory-lancedb-pro` main-branch check, repo `CortexReach/memory-lancedb-pro` at `1f44e05caeca45c00531cef366bac8521ddad2e3`:

- The plugin still constructs its own OpenAI-compatible embedding clients in `src/embedder.ts`.
- The plugin still constructs its own OpenAI-compatible smart-extraction LLM client in `src/llm-client.ts`.
- The plugin manifest still exposes plugin-local `embedding.apiKey`, `embedding.baseURL`, `embedding.model`, `llm.apiKey`, `llm.baseURL`, `llm.model`, and `llm.auth`.
- No option was found for the plugin to reference OpenClaw `models.providers` or to delegate these smart-extraction/embedding requests to the configured OpenClaw model provider.
- One exception exists: the plugin's memory-reflection path can use OpenClaw's embedded runner, so that path should use OpenClaw's normal model/provider machinery. This does not cover smart extraction, embeddings, or rerank fetches.

Conclusion: this attribution behavior is still required for `memory-lancedb-pro` if VIDA config points the plugin's `embedding.baseURL` or `llm.baseURL` at `${VIDA_API_BASE_URL}/openai/v1` and usage/billing must be attributed to the current agent/session.

### Partially Keep, But Shrink

| Change                                                                                                             | Decision         | Reason                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/gateway/openresponses-http.ts` fork changes                                                                   | Partial keep     | Upstream has absorbed much of the generic hosted-run behavior.                                                  |
| `src/gateway/open-responses.schema.ts` changes                                                                     | Partial keep     | Upstream accepts `function_call_output` input but not output. Keep output-side tool-result items unless `vida.live` replaces operator delegated-tool evidence another way. |
| Agent command/run plumbing for `providerMetadata`, `toolResultMaxDataBytes`, `onReasoningStream`, `reasoningLevel` | Partial keep     | Needed only for remaining hosted `/v1/responses` integration behavior.                                          |
| `src/agents/pi-embedded-subscribe*` tool/result changes                                                            | Partial keep     | Keep only if client-visible tool outputs/tool-result caps are still required.                                   |
| `session-tool-result-guard-wrapper.ts` provider metadata preservation                                              | Conditional keep | Keep if hosted-run/provider metadata relay still needs transcript persistence.                                  |

Specific OpenResponses pieces that may still need a fork patch:

- accepting and forwarding inbound `provider_metadata`;
- preserving the `metadata["vida.ignoreOnProviderRelay"] === "true"` fallback that becomes `{ vida: { ignoreOnProviderRelay: true } }`;
- accepting inbound `reasoning` from `vida.live` OpenResponses callers and using it to enable hosted reasoning streaming;
- preserving `reasoning.summary` behavior when emitting OpenResponses `reasoning` output items;
- mapping `reasoning.effort` into actual OpenClaw thinking/reasoning depth, or explicitly accepting that VIDA operator `thinkingEffort` will not affect hosted OpenClaw depth;
- `toolResultMaxDataBytes` config if this cap is still operationally needed; no direct `vida.live` request field was found for it;
- binary/base64 tool-result sanitization semantics: keep `data` only when it is under the configured decoded-byte cap; otherwise omit `data` and return `bytes`/`omitted`;
- `onReasoningStream` callback plumbing;
- streaming OpenClaw internal tool-call events into `function_call` output items, only if VIDA still wants client-visible internal tool calls;
- accepting `function_call_output` request input for turn-based client tools;
- emitting OpenClaw internal tool results as `function_call_output` output items unless `vida.live` replaces operator delegated-tool evidence another way;
- transcript metadata preservation for hosted-run relay behavior;
- `safeJsonStringify` behavior for non-string or non-JSON tool outputs.

Important detail: this reasoning support is for the `vida.live` or other hosted clients calling OpenClaw Gateway `/v1/responses`. It is separate from outbound OpenClaw model-provider calls to `vida.live` through `${VIDA_API_BASE_URL}/openai/v1`.

In the current fork, inbound `payload.reasoning` does three things:

- marks the hosted run as `reasoningLevel: "stream"`;
- wires `onReasoningStream` so reasoning deltas become OpenResponses `reasoning` output items;
- uses `reasoning.summary` to decide whether emitted reasoning text is placed in `summary` or `content`.

Current limitation: `reasoning.effort` is accepted for OpenResponses API parity but is explicitly ignored in the fork. The `vida.live` code does send effort values from operator `thinkingEffort`, so this is a real decision point, not cosmetic parity. If VIDA wants `low` / `medium` / `high` to change OpenClaw hosted execution depth, that mapping needs to be implemented.

Latest upstream note: `v2026.6.10` already has significant hosted OpenResponses support, including client tool definitions, `tool_choice`, request-schema `reasoning`, file/image input work, and pending client tool-call output. Do not carry the old whole-file OpenResponses diff forward. Reapply only the remaining VIDA-specific behavior on top of the latest upstream handler.

### Conditional Outbound Relay Behavior From `vida-responses`

The custom `vida-responses` provider contains behavior that is separate from its existence as a provider API:

- top-level outbound `provider_metadata`;
- a `metadata["vida.ignoreOnProviderRelay"] = "true"` compatibility flag when relay metadata asks VIDA to ignore provider relay billing;
- `provider_metadata.vida.reasoningEffort`, including `"none"`, overriding outbound Responses `reasoning`;
- fallback lookup of relay metadata from recent transcript messages/parts;
- malformed function-call argument tolerance in stream parsing;
- OpenAI client resolution through the nested `@mariozechner/pi-ai` dependency.

Recommendation for a future downstream migration:

- Do not keep the custom provider just for this.
- First verify whether current `vida.live` still needs these outbound relay controls for normal OpenClaw model calls after switching to stock `openai-responses`/`openai-completions`.
- If needed, replace with the smallest possible upstream-compatible mechanism: generated config, provider plugin hook/wrapper, or a tiny patch to the stock OpenAI-compatible provider path.
- The malformed JSON hardening appears largely covered by current upstream parsing/repair helpers in `v2026.6.10`, so retest before porting.
- The nested OpenAI client resolution should be unnecessary once the stock upstream provider is used.

### Hosted Client Tools

This behavior is required. VIDA sends function/tool options through `fetchResponse` and OpenAI-compatible controller paths, and OpenClaw must expose those as hosted `/v1/responses` client tools so the model can choose a function call instead of ordinary text.

Evidence:

- `vida.live/lib/openAiHelper.js` builds `completionDict.functions` from campaign/loadFunctions and sets `function_call = "auto"`.
- `vida.live/lib/models/OAIRequestAdapter.js` runs `OAIRequestFunctionsToToolsStage`, which converts OpenAI-style `functions` into AI SDK `tools` and `toolChoice`.
- `vida.live/lib/controllers/openai/v1/responsesController.js` and `chat/completionsController.js` pass `tools` and `toolChoice` to the model layer.
- VIDA commit `edbee9f835` was explicitly titled "Fixing possible bug with client tools not being passed to agent comments via responses api" and added `clientTools: params.clientTools` to the embedded run.
- Upstream commit `a07dcfde84` / PR `#52171` fixed the same bug class by passing `clientTools` to the `/v1/responses` embedded-agent path.
- Upstream `v2026.6.10` extracts `body.tools`, applies `tool_choice`, passes `clientTools` into `agentCommandFromIngress`, and returns pending client tool calls as `function_call` output items.

Recommendation: keep the behavior and keep a regression test, but do not re-port the old VIDA client-tools patch blindly. On `v2026.6.10`, this is mostly upstream behavior. Reapply only any VIDA-specific gap found in tests, such as interaction with `provider_metadata`, reasoning callbacks, or the custom `@vida-global/openclaw-ai-sdk-provider`.

### Block Reply Callback Dispatch

The fork changes `subscribeEmbeddedPiSession` from always deferring `onBlockReply` through `Promise.resolve().then(...)` to direct invocation with both synchronous throw handling and async `.catch(...)` handling.

This is not the same as the OpenResponses tool-output cap. Treat it as a separate small behavior:

- The code change removes the microtask deferral around `params.onBlockReply(payload)`. Before: the callback always ran later through `Promise.resolve().then(...)`. After: the callback is invoked synchronously, while still catching both synchronous throws and async promise rejections.
- Provenance is weak. `git blame` shows the exact change entering in squashed release-sync commit `4d6830dc77` (`Sync fork release to upstream v2026.3.22`), not in the named OpenResponses commit `03a48da13`. The README describes broad OpenResponses/embedded-runner hosted-run parity but does not specifically justify this scheduler change.
- No direct test or doc found so far proves this exact synchronous dispatch is required.

Recommendation: do not carry this just because it is in the fork. Keep it only if a rebase test or production repro shows that deferring `onBlockReply` causes a hosted streaming/order/error-reporting problem. Otherwise prefer upstream behavior.

### Likely Drop Or Reduce After Smoke Test

| Change                                               | Decision     | Reason                                                              |
| ---------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| Browser reliability patches in `src/browser/client*` | Try dropping | Upstream has added substantial browser fetch hardening since March. |

Fork browser behavior to test before deciding:

- action-path timeouts/aborts get bounded retry guidance: take a fresh browser snapshot, retry once with updated refs, then report unavailable;
- non-action timeout guidance remains strict no-retry guidance;
- local dispatcher/HTTP route errors preserve the real error body instead of wrapping everything as service outage;
- `browserStatus`, `browserProfiles`, and `browserTabs` use 10s read timeouts;
- those read calls retry once after timeout-like failures, default delay 1500ms.

Recommended approach: drop the broad browser patch first, then run a production-like browser smoke test. Re-add only a narrow timeout/retry patch if the old failure mode still reproduces.

### Keep As Small VIDA-Specific Patches

| Change                                       | Decision                    | Reason                                                                          |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| WhatsApp browser identity change             | Keep if WhatsApp still used | Upstream still uses OpenClaw identity.                                          |
| WhatsApp nested disconnect status extraction | Keep if WhatsApp still used | Upstream still appears not to inspect `lastDisconnect.error.output.statusCode`. |

### Keep

| Change                         | Decision    | Reason                                                                          |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------- |
| Release sync scripts/docs      | Keep        | Fork operations tooling. Not replaced by upstream.                              |
| README VIDA fork delta section | Keep/update | Should reflect what was dropped, moved downstream, or reduced after the rebase. |

## Recommended OpenClaw + Provisioner Rebase Order

1. Start from upstream `v2026.6.10`.
2. Reapply only compatibility patches required by current downstream consumers.
3. Update/verify provisioner normalization so the actual deployed runtime config reaching OpenClaw does not reference `api: "vida-responses"` and contains both `x-vida-account-id` and `x-openclaw-agent-id`.
4. Keep hosted `/v1/responses` compatibility consumed by `@vida-global/openclaw-ai-sdk-provider@0.2.0`: `provider_metadata`, reasoning options/events, stable reasoning IDs, internal `function_call` and `function_call_output` output items, tool-result caps/sanitization, and usage/finish metadata.
5. Keep plugin-owned request attribution in OpenClaw.
6. Drop or shrink browser patches only after latest-upstream smoke tests prove the old failure modes are covered.
7. Keep WhatsApp patches if WhatsApp remains a supported VIDA channel.
8. Keep release workflow docs/scripts.

## Future Migration Order If Downstream Changes Are Allowed

1. Update downstream config generation to stop emitting `api: "vida-responses"`.
2. Ensure generated per-agent provider config includes both `x-vida-account-id` and `x-openclaw-agent-id`.
3. Verify one multi-agent gateway routes LLM requests to `vida.live` with correct usage attribution.
4. Remove `vida-responses` provider/schema/runtime registration from the OpenClaw fork.
5. Rebase OpenResponses hosted-run support as a small residual patch.
6. Keep or rehome plugin-owned request attribution.
7. Drop browser patches and smoke test.
8. Keep the tiny WhatsApp and release tooling patches if still operationally needed.

## Bottom Line

Under the OpenClaw + provisioner assumption, the current suggested keep/drop list is:

Current safe position:

- drop `vida-responses` from the OpenClaw fork only if provisioner normalization proves OpenClaw never sees it;
- keep hosted OpenResponses behavior consumed by current `vida.live` and `@vida-global/openclaw-ai-sdk-provider`;
- keep hosted `/v1/responses` client-tools behavior, while relying on upstream `v2026.6.10` where it is equivalent;
- keep plugin-owned Vida OpenAI request attribution in OpenClaw;
- WhatsApp operational defaults/status handling;
- release workflow tooling.

The main drop candidates for this rebase are duplicate patches where latest upstream demonstrably has equivalent behavior, especially broad browser/client-tool changes and the unexplained `onBlockReply` scheduling change. Deleting `@vida-global/openclaw-ai-sdk-provider` still belongs to a later `vida.live` migration.
