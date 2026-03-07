import { describe, expect, it } from "vitest";
import { buildVidaResponsesParamsForTest } from "./vida-responses.js";

function makeModel(overrides?: Record<string, unknown>) {
  return {
    id: "gpt-5",
    name: "gpt-5",
    provider: "openai",
    api: "openai-responses",
    input: ["text"],
    reasoning: true,
    ...overrides,
  };
}

describe("vida-responses provider relay metadata", () => {
  it("writes top-level provider_metadata and relay metadata flag", () => {
    const providerMetadata = {
      vida: {
        ignoreOnProviderRelay: true,
        reasoningEffort: "low",
      },
    };
    const params = buildVidaResponsesParamsForTest(
      makeModel(),
      { messages: [{ role: "user", content: "hi" }] },
      {
        providerMetadata,
        reasoningEffort: "high",
      },
    );

    expect(params.provider_metadata).toEqual(providerMetadata);
    expect(params.metadata).toEqual({
      "vida.ignoreOnProviderRelay": "true",
    });
    expect(params.reasoning).toEqual({
      effort: "low",
      summary: "auto",
    });
  });

  it("falls back to message-level providerMetadata when options metadata is absent", () => {
    const params = buildVidaResponsesParamsForTest(
      makeModel(),
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            providerMetadata: {
              vida: {
                ignoreOnProviderRelay: true,
              },
            },
          },
        ],
      },
      {},
    );

    expect(params.provider_metadata).toEqual({
      vida: {
        ignoreOnProviderRelay: true,
      },
    });
    expect(params.metadata).toEqual({
      "vida.ignoreOnProviderRelay": "true",
    });
  });

  it("keeps default reasoning source when relay metadata has no reasoning override", () => {
    const params = buildVidaResponsesParamsForTest(
      makeModel(),
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            providerMetadata: {
              vida: {
                ignoreOnProviderRelay: true,
              },
            },
          },
        ],
      },
      {
        reasoningEffort: "high",
      },
    );

    expect(params.reasoning).toEqual({
      effort: "high",
      summary: "auto",
    });
  });

  it("omits reasoning when relay metadata explicitly requests none", () => {
    const params = buildVidaResponsesParamsForTest(
      makeModel(),
      { messages: [{ role: "user", content: "hi" }] },
      {
        providerMetadata: {
          vida: {
            ignoreOnProviderRelay: true,
            reasoningEffort: "none",
          },
        },
        reasoningEffort: "high",
      },
    );

    expect(params.provider_metadata).toEqual({
      vida: {
        ignoreOnProviderRelay: true,
        reasoningEffort: "none",
      },
    });
    expect(params).not.toHaveProperty("reasoning");
  });
});
