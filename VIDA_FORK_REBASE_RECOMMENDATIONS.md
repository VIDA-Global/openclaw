# VIDA OpenClaw Fork Rebase Recommendations

Date: 2026-06-29

Baseline reviewed: `vida-v2026.3.24`

Current upstream target reviewed: `v2026.6.10`

## Summary

The VIDA fork can likely be made much smaller before rebasing to the latest upstream OpenClaw release.

The largest removable piece is the custom `vida-responses` provider. Current VIDA architecture already creates one model provider per agent, such as `vida-2301795`, and points that agent at its own provider/model. That means the standard upstream OpenAI-compatible provider adapters should be sufficient if the generated provider config includes the correct VIDA/OpenClaw attribution headers.

The main behavior that must not be lost is request attribution. `vida.live` needs to know which agent/account a request belongs to, especially on gateways hosting multiple agent IDs.

## Critical Replacement For `vida-responses`

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

`openai-completions` may also work if that remains the desired compatibility surface for a specific path, but the important point is that `vida-responses` should not be needed as a custom OpenClaw API adapter.

## Completeness Audit Against `vida-v2026.3.24`

This table reconciles the recommendation set against every file changed by:

```sh
git diff --name-status v2026.3.24...vida-v2026.3.24
```

| Fork area/files                                                                                                                                             | Behavior in fork                                                                                                                                                                                                                 | Current recommendation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                                                                 | Documents VIDA deltas and historical fork-only commits.                                                                                                                                                                          | Keep/update after rebase.                                                                                                                                                                                                                 |
| `scripts/README.vida-release-sync.md`, `scripts/sync-upstream-main.sh`, `scripts/sync-upstream-release.sh`, `scripts/verify-vida-release.sh`                | Fork release sync workflow, fork tag creation, Docker ref/date-tag verification, Codex conflict handoff files.                                                                                                                   | Keep. This is fork operations tooling, not upstream product behavior.                                                                                                                                                                     |
| `src/providers/vida-responses.ts`, `src/providers/vida-responses-shared.ts`, provider tests                                                                 | Custom OpenAI Responses-like provider adapter, OpenAI client resolution, Responses message/tool conversion, stream parsing, malformed function-call JSON tolerance, relay metadata/reasoning mapping.                            | Drop the custom provider if stock OpenAI-compatible config works. Preserve only any proven VIDA-specific relay behavior as a narrow patch or downstream config/hook.                                                                      |
| `src/config/types.models.ts`, `src/config/types.gateway.ts`, `src/config/schema.base.generated.ts`, `src/config/zod-schema.ts`, `src/config/schema.test.ts` | Adds `vida-responses` to the canonical model API enum/schema. Adds `gateway.http.endpoints.responses.toolResultMaxDataBytes`.                                                                                                    | Drop `vida-responses` schema entries. Keep only `toolResultMaxDataBytes` if the hosted Responses tool-output cap remains required.                                                                                                        |
| `src/gateway/openresponses-http.ts`, `src/gateway/open-responses.schema.ts`, OpenResponses tests                                                            | Hosted `/v1/responses` parity: inbound `provider_metadata`, inbound `reasoning`, emitted reasoning items, tool-event output items, `function_call_output` output schema, `toolResultMaxDataBytes`, fallback metadata relay flag. | Partially keep. Rebase as small targeted patches on top of upstream `v2026.6.10`, because upstream has already absorbed some generic client-tool/Responses work.                                                                          |
| `src/agents/agent-command.ts`, `src/agents/command/types.ts`, `src/agents/pi-embedded-runner/run*.ts`, `src/commands/agent.vida-forwarding.test.ts`         | Plumbs `reasoningLevel`, `providerMetadata`, `toolResultMaxDataBytes`, `onReasoningStream`, and `clientTools` from hosted ingress into embedded execution. Imports/registers `vida-responses`.                                   | Drop the provider registration/import. Keep only plumbing still missing upstream for the remaining hosted Responses features.                                                                                                             |
| `src/agents/pi-embedded-subscribe*`, `src/agents/session-tool-result-guard-wrapper.ts`, related tests                                                       | Emits/sanitizes tool results, enforces base64 `data` byte cap, persists provider metadata to transcript messages, and changes `onBlockReply` callback dispatch to direct sync invocation with sync/async error handling.         | Partially keep. Tool-result cap/metadata persistence are conditional on hosted Responses requirements. The `onBlockReply` dispatch change is a separate small decision item and should be tested against latest upstream before carrying. |
| `src/plugins/hook-runner-global.ts`, `src/plugins/hooks.ts`, `src/plugins/runtime/request-attribution-*`, attribution tests                                 | AsyncLocalStorage scope around plugin hooks; global `fetch` wrapper adds `x-openclaw-agent-id` and `x-openclaw-session-key` only for `${VIDA_API_BASE_URL}/openai/v1/*` plugin-owned requests.                                   | Keep behavior or move to `vida-openclaw-plugin`. Do not drop until plugin-owned OpenAI traffic has another attribution path.                                                                                                              |
| `src/browser/client-fetch.ts`, `src/browser/client.ts`, browser tests                                                                                       | Browser error classification, action-path bounded retry guidance, 10s read/status timeouts, one retry after timeout-like read failure.                                                                                           | Try dropping first, because browser code changed heavily upstream. Re-add only a narrow patch if smoke tests reproduce the old failure.                                                                                                   |
| `extensions/whatsapp/src/session.ts`, `extensions/whatsapp/src/session-errors.ts`, WhatsApp tests                                                           | Uses `["Vida Operator", "web", VERSION]` WhatsApp browser identity and extracts nested `lastDisconnect.error.output.statusCode`.                                                                                                 | Keep if WhatsApp remains a VIDA-supported channel and upstream still lacks these exact behaviors.                                                                                                                                         |

### Drop From The OpenClaw Fork

| Change                                                  | Decision | Reason                                                                                                                 |
| ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/providers/vida-responses.ts`                       | Drop     | Standard OpenAI-compatible provider config should route model calls through `vida.live`.                               |
| `src/providers/vida-responses-shared.ts`                | Drop     | Mostly supports the custom provider. Re-evaluate only if a specific parser is still needed for hosted `/v1/responses`. |
| `src/providers/vida-responses*.test.ts`                 | Drop     | Goes with provider removal.                                                                                            |
| `api: "vida-responses"` in `src/config/types.models.ts` | Drop     | Not needed once generated config uses `openai-responses` or `openai-completions`.                                      |
| Generated schema entries for `vida-responses`           | Drop     | Same reason.                                                                                                           |
| Config schema tests for `vida-responses`                | Drop     | Same reason.                                                                                                           |
| Import/registration of `vida-responses` in the runner   | Drop     | Stock OpenAI-compatible provider adapter should be used instead.                                                       |

### Keep Downstream, Not In The OpenClaw Fork

| Behavior                                   | Decision               | Reason                                                                                      |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------- |
| One provider per agent ID                  | Keep downstream        | Multi-agent gateways require per-agent account/agent attribution.                           |
| `vida.live` OpenClaw LLM config generation | Update downstream      | It should emit stock OpenAI-compatible APIs and both attribution headers.                   |
| Provisioner legacy config normalization    | Keep/update downstream | It already rewrites `vida-responses` to `openai-completions`; finalize this migration path. |

Current downstream issue: `vida.live/lib/openclaw/llmConfig.js` adds `x-vida-account-id`, but it also needs to add `x-openclaw-agent-id` if `vida-responses` is removed.

### Keep Or Rehome, But Do Not Drop Behavior

| Change                                                                                        | Decision                               | Reason                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Plugin-owned request attribution (`src/plugins/runtime/request-attribution-*`)                | Keep or move to `vida-openclaw-plugin` | Plugin-created OpenAI clients/fetch calls bypass normal model provider config. |
| `x-openclaw-agent-id` / `x-openclaw-session-key` injection for plugin-owned Vida OpenAI calls | Keep behavior                          | Required for correct attribution in multi-agent gateways.                      |

This remains important even if model provider config is fixed, because plugin lifecycle hooks can create their own SDK clients or direct fetches to `${VIDA_API_BASE_URL}/openai/v1`.

### Partially Keep, But Shrink

| Change                                                                                                             | Decision         | Reason                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/gateway/openresponses-http.ts` fork changes                                                                   | Partial keep     | Upstream has absorbed much of the generic hosted-run behavior.                                                  |
| `src/gateway/open-responses.schema.ts` changes                                                                     | Partial keep     | Upstream accepts `function_call_output` input, but some output/provider-metadata behavior may still be missing. |
| Agent command/run plumbing for `providerMetadata`, `toolResultMaxDataBytes`, `onReasoningStream`, `reasoningLevel` | Partial keep     | Needed only for remaining hosted `/v1/responses` integration behavior.                                          |
| `src/agents/pi-embedded-subscribe*` tool/result changes                                                            | Partial keep     | Keep only if client-visible tool outputs/tool-result caps are still required.                                   |
| `session-tool-result-guard-wrapper.ts` provider metadata preservation                                              | Conditional keep | Keep if hosted-run/provider metadata relay still needs transcript persistence.                                  |

Specific OpenResponses pieces that may still need a fork patch:

- accepting and forwarding inbound `provider_metadata`;
- preserving the `metadata["vida.ignoreOnProviderRelay"] === "true"` fallback that becomes `{ vida: { ignoreOnProviderRelay: true } }`;
- accepting inbound `reasoning` from Vida/backend OpenResponses callers and using it to enable hosted reasoning streaming;
- preserving `reasoning.summary` behavior when emitting OpenResponses `reasoning` output items;
- deciding whether `reasoning.effort` should remain ignored, as in the current fork, or should be mapped into OpenClaw thinking/reasoning depth;
- `toolResultMaxDataBytes` config;
- binary/base64 tool-result sanitization semantics: keep `data` only when it is under the configured decoded-byte cap; otherwise omit `data` and return `bytes`/`omitted`;
- `onReasoningStream` callback plumbing;
- streaming OpenClaw internal tool events into `function_call` and `function_call_output` output items;
- output schema support for `function_call_output`;
- transcript metadata preservation for hosted-run relay behavior;
- `safeJsonStringify` behavior for non-string or non-JSON tool outputs.

Important detail: this reasoning support is for the `vida.live` or other hosted clients calling OpenClaw Gateway `/v1/responses`. It is separate from outbound OpenClaw model-provider calls to `vida.live` through `${VIDA_API_BASE_URL}/openai/v1`.

In the current fork, inbound `payload.reasoning` does three things:

- marks the hosted run as `reasoningLevel: "stream"`;
- wires `onReasoningStream` so reasoning deltas become OpenResponses `reasoning` output items;
- uses `reasoning.summary` to decide whether emitted reasoning text is placed in `summary` or `content`.

Current limitation: `reasoning.effort` is accepted for OpenResponses API parity but is explicitly ignored in the fork. If Vida expects `reasoning.effort` from backend requests to change the agent's actual thinking depth, that needs to be added or consciously left out.

Latest upstream note: `v2026.6.10` already has significant hosted OpenResponses support, including client tool definitions, `tool_choice`, request-schema `reasoning`, file/image input work, and pending client tool-call output. Do not carry the old whole-file OpenResponses diff forward. Reapply only the remaining VIDA-specific behavior on top of the latest upstream handler.

### Conditional Outbound Relay Behavior From `vida-responses`

The custom `vida-responses` provider contains behavior that is separate from its existence as a provider API:

- top-level outbound `provider_metadata`;
- a `metadata["vida.ignoreOnProviderRelay"] = "true"` compatibility flag when relay metadata asks VIDA to ignore provider relay billing;
- `provider_metadata.vida.reasoningEffort`, including `"none"`, overriding outbound Responses `reasoning`;
- fallback lookup of relay metadata from recent transcript messages/parts;
- malformed function-call argument tolerance in stream parsing;
- OpenAI client resolution through the nested `@mariozechner/pi-ai` dependency.

Recommendation:

- Do not keep the custom provider just for this.
- First verify whether current `vida.live` still needs these outbound relay controls for normal OpenClaw model calls after switching to stock `openai-responses`/`openai-completions`.
- If needed, replace with the smallest possible upstream-compatible mechanism: generated config, provider plugin hook/wrapper, or a tiny patch to the stock OpenAI-compatible provider path.
- The malformed JSON hardening appears largely covered by current upstream parsing/repair helpers in `v2026.6.10`, so retest before porting.
- The nested OpenAI client resolution should be unnecessary once the stock upstream provider is used.

### Hosted Client Tools

The current fork forwards `clientTools` from hosted `/v1/responses` through `agentCommandFromIngress` into embedded execution. Upstream `v2026.6.10` already has client tool extraction, `tool_choice` handling, and pending client tool-call responses.

Recommendation: do not port the fork's client-tool forwarding as a standalone patch unless a rebase test proves a VIDA-specific gap remains. Keep the tests conceptually, but adapt them to assert only the behavior latest upstream does not already cover.

### Block Reply Callback Dispatch

The fork changes `subscribeEmbeddedPiSession` from always deferring `onBlockReply` through `Promise.resolve().then(...)` to direct invocation with both synchronous throw handling and async `.catch(...)` handling.

This is not the same as the OpenResponses tool-output cap. Treat it as a separate small behavior:

- Keep only if it fixes an observed hosted streaming/order/error-reporting issue.
- Otherwise drop it during rebase to avoid carrying an unexplained scheduler change.

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

## Recommended Migration Order

1. Update downstream config generation to stop emitting `api: "vida-responses"`.
2. Ensure generated per-agent provider config includes both `x-vida-account-id` and `x-openclaw-agent-id`.
3. Verify one multi-agent gateway routes LLM requests to `vida.live` with correct usage attribution.
4. Remove `vida-responses` provider/schema/runtime registration from the OpenClaw fork.
5. Rebase OpenResponses hosted-run support as a small residual patch.
6. Keep or rehome plugin-owned request attribution.
7. Drop browser patches and smoke test.
8. Keep the tiny WhatsApp and release tooling patches if still operationally needed.

## Bottom Line

The fork should no longer need a custom `vida-responses` OpenClaw provider for normal LLM routing.

The fork probably still needs small targeted patches for:

- hosted OpenResponses behavior;
- plugin-owned Vida OpenAI request attribution, unless moved into the VIDA plugin;
- WhatsApp operational defaults/status handling;
- release workflow tooling.

Everything else should be treated as a candidate to drop or move downstream before rebasing.
