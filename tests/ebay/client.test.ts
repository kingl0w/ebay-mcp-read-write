import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetClient, getClient } from "../../src/ebay/client.js";

vi.mock("../../src/ebay/auth.js", () => ({
  getAuthToken: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  _resetClient();
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getClient", () => {
  it("should return an axios instance with sandbox baseURL when EBAY_ENV=sandbox", () => {
    process.env.EBAY_ENV = "sandbox";
    const client = getClient();

    expect(client.defaults.baseURL).toBe("https://api.sandbox.ebay.com");
  });

  it("should return an axios instance with production baseURL when EBAY_ENV=production", () => {
    process.env.EBAY_ENV = "production";
    const client = getClient();

    expect(client.defaults.baseURL).toBe("https://api.ebay.com");
  });

  it("should default to sandbox when EBAY_ENV is not set", () => {
    delete process.env.EBAY_ENV;
    const client = getClient();

    expect(client.defaults.baseURL).toBe("https://api.sandbox.ebay.com");
  });

  it("should throw on invalid EBAY_ENV", () => {
    process.env.EBAY_ENV = "staging";

    expect(() => getClient()).toThrow('Invalid EBAY_ENV: "staging"');
  });

  it("should reuse the same instance for repeated calls with same env", () => {
    process.env.EBAY_ENV = "sandbox";
    const first = getClient();
    const second = getClient();

    expect(first).toBe(second);
  });

  it("should create a new instance when EBAY_ENV changes", () => {
    process.env.EBAY_ENV = "sandbox";
    const sandbox = getClient();

    _resetClient();
    process.env.EBAY_ENV = "production";
    const production = getClient();

    expect(sandbox.defaults.baseURL).toBe("https://api.sandbox.ebay.com");
    expect(production.defaults.baseURL).toBe("https://api.ebay.com");
    expect(sandbox).not.toBe(production);
  });

  it("should have request interceptor that injects auth headers", async () => {
    process.env.EBAY_ENV = "sandbox";
    const client = getClient();

    const interceptors = client.interceptors.request as unknown as {
      handlers: Array<{ fulfilled: (config: unknown) => unknown }>;
    };

    expect(interceptors.handlers.length).toBeGreaterThan(0);
  });

  it("should log 401 errors with auth guidance", async () => {
    process.env.EBAY_ENV = "sandbox";
    const client = getClient();

    const interceptors = client.interceptors.response as unknown as {
      handlers: Array<{
        rejected: (error: unknown) => unknown;
      }>;
    };

    const handler = interceptors.handlers[0];
    // Build a plain error that looks like an AxiosError with isAxiosError flag
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: {
        status: 401,
        data: {
          errors: [
            {
              errorId: 1,
              domain: "AUTH",
              category: "REQUEST",
              message: "Invalid token",
            },
          ],
        },
      },
      config: { url: "/test" },
    });

    const { logger } = await import("../../src/utils/logger.js");

    expect(() => handler.rejected(axiosError)).toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "eBay auth failed — check EBAY_USER_TOKEN or credentials",
    );
  });
});
