import { describe, expect, it } from "vitest";
import { getStatusCode } from "./session-errors.js";

describe("session error helpers", () => {
  it("extracts direct and nested Boom status codes before status fallback", () => {
    expect(getStatusCode({ output: { statusCode: 409 }, status: 500 })).toBe(409);
    expect(getStatusCode({ error: { output: { statusCode: 408 } }, status: 500 })).toBe(408);
    expect(
      getStatusCode({
        lastDisconnect: {
          error: {
            output: {
              statusCode: 401,
            },
          },
        },
        status: 500,
      }),
    ).toBe(401);
    expect(getStatusCode({ status: 503 })).toBe(503);
  });
});
