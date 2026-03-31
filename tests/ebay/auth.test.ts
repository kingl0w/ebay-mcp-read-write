import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetTokenCache,
  getAppToken,
  getAuthToken,
  getUserToken,
} from "../../src/ebay/auth.js";

vi.mock("axios");
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
  _resetTokenCache();
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getAppToken", () => {
  it("should POST with correct Basic auth header for sandbox", async () => {
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_SANDBOX_CLIENT_ID = "my-client-id";
    process.env.EBAY_SANDBOX_CLIENT_SECRET = "my-client-secret";

    const expectedCredentials = Buffer.from(
      "my-client-id:my-client-secret",
    ).toString("base64");

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "app-token-123",
        token_type: "Application Access Token",
        expires_in: 7200,
      },
    });

    const token = await getAppToken();

    expect(token).toBe("app-token-123");
    expect(axios.post).toHaveBeenCalledWith(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
      "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${expectedCredentials}`,
        },
        timeout: 15000,
      },
    );
  });

  it("should POST to production endpoint when EBAY_ENV=production", async () => {
    process.env.EBAY_ENV = "production";
    process.env.EBAY_PROD_CLIENT_ID = "prod-id";
    process.env.EBAY_PROD_CLIENT_SECRET = "prod-secret";

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "prod-token",
        token_type: "Application Access Token",
        expires_in: 7200,
      },
    });

    const token = await getAppToken();

    expect(token).toBe("prod-token");
    expect(axios.post).toHaveBeenCalledWith(
      "https://api.ebay.com/identity/v1/oauth2/token",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("should return cached token on subsequent calls", async () => {
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_SANDBOX_CLIENT_ID = "id";
    process.env.EBAY_SANDBOX_CLIENT_SECRET = "secret";

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "cached-token",
        token_type: "Application Access Token",
        expires_in: 7200,
      },
    });

    const first = await getAppToken();
    const second = await getAppToken();

    expect(first).toBe("cached-token");
    expect(second).toBe("cached-token");
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("should throw when credentials are missing", async () => {
    process.env.EBAY_ENV = "sandbox";
    delete process.env.EBAY_SANDBOX_CLIENT_ID;
    delete process.env.EBAY_SANDBOX_CLIENT_SECRET;

    await expect(getAppToken()).rejects.toThrow(
      "Missing EBAY_SANDBOX_CLIENT_ID or EBAY_SANDBOX_CLIENT_SECRET",
    );
  });
});

describe("getUserToken", () => {
  it("should return EBAY_USER_TOKEN when set", async () => {
    process.env.EBAY_USER_TOKEN = "user-token-abc";
    delete process.env.EBAY_REFRESH_TOKEN;
    expect(await getUserToken()).toBe("user-token-abc");
  });

  it("should return null and log warning when EBAY_USER_TOKEN is missing", async () => {
    process.env.EBAY_ENV = "sandbox";
    delete process.env.EBAY_USER_TOKEN;
    delete process.env.EBAY_REFRESH_TOKEN;

    const { logger } = await import("../../src/utils/logger.js");
    const result = await getUserToken();

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "No EBAY_USER_TOKEN or EBAY_REFRESH_TOKEN found",
      ),
    );
  });

  it("should reference production URL when EBAY_ENV=production", async () => {
    process.env.EBAY_ENV = "production";
    delete process.env.EBAY_USER_TOKEN;
    delete process.env.EBAY_REFRESH_TOKEN;

    const { logger } = await import("../../src/utils/logger.js");
    await getUserToken();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("env=production"),
    );
  });
});

describe("getAuthToken", () => {
  it("should return user token when available", async () => {
    process.env.EBAY_USER_TOKEN = "user-token-xyz";

    const token = await getAuthToken();
    expect(token).toBe("user-token-xyz");
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("should fall back to app token when user token is missing", async () => {
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_SANDBOX_CLIENT_ID = "id";
    process.env.EBAY_SANDBOX_CLIENT_SECRET = "secret";
    delete process.env.EBAY_USER_TOKEN;

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "fallback-app-token",
        token_type: "Application Access Token",
        expires_in: 7200,
      },
    });

    const token = await getAuthToken();
    expect(token).toBe("fallback-app-token");
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
