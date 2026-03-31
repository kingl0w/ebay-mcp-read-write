import axios from "axios";
import { logger } from "../utils/logger.js";
import type { EbayAuthToken, EbayEnvironment } from "./types.js";

const TOKEN_URLS: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  production: "https://api.ebay.com/identity/v1/oauth2/token",
};

const USER_TOKEN_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

let cachedAppToken: EbayAuthToken | null = null;
let cachedUserToken: { access_token: string; expiry_timestamp: number } | null =
  null;
let tokenRefreshPromise: Promise<string> | null = null;
let userTokenRefreshPromise: Promise<string> | null = null;

function getEnv(): EbayEnvironment {
  const env = process.env.EBAY_ENV ?? "sandbox";
  if (env !== "sandbox" && env !== "production") {
    throw new Error(
      `Invalid EBAY_ENV: "${env}". Must be "sandbox" or "production".`,
    );
  }
  return env;
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const env = getEnv();
  const prefix = env === "sandbox" ? "EBAY_SANDBOX" : "EBAY_PROD";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing ${prefix}_CLIENT_ID or ${prefix}_CLIENT_SECRET in environment variables.`,
    );
  }

  return { clientId, clientSecret };
}

export async function getAppToken(): Promise<string> {
  if (cachedAppToken && Date.now() < cachedAppToken.expiry_timestamp) {
    return cachedAppToken.access_token;
  }

  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    try {
      const env = getEnv();
      const { clientId, clientSecret } = getCredentials();
      const url = TOKEN_URLS[env];
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      );

      const response = await axios.post<EbayAuthToken>(
        url,
        "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
          timeout: 15000,
        },
      );

      cachedAppToken = {
        ...response.data,
        expiry_timestamp:
          Date.now() + (response.data.expires_in - 120) * 1000,
      };

      logger.info("eBay application token refreshed");
      return cachedAppToken.access_token;
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

export async function refreshUserToken(): Promise<string> {
  const refreshToken = process.env.EBAY_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "EBAY_REFRESH_TOKEN not set — cannot refresh user token. Run `pnpm get-token` to generate new tokens.",
    );
  }

  if (userTokenRefreshPromise) {
    return userTokenRefreshPromise;
  }

  userTokenRefreshPromise = (async () => {
    try {
      const env = getEnv();
      const { clientId, clientSecret } = getCredentials();
      const url = TOKEN_URLS[env];
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      );

      logger.info("Refreshing eBay user token via refresh_token grant");
      const response = await axios.post<EbayAuthToken>(
        url,
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(USER_TOKEN_SCOPES)}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
          timeout: 15000,
        },
      );

      cachedUserToken = {
        access_token: response.data.access_token,
        expiry_timestamp:
          Date.now() + (response.data.expires_in - 120) * 1000,
      };

      logger.info("eBay user token refreshed successfully");
      return cachedUserToken.access_token;
    } finally {
      userTokenRefreshPromise = null;
    }
  })();

  return userTokenRefreshPromise;
}

export async function getUserToken(): Promise<string | null> {
  if (cachedUserToken && Date.now() < cachedUserToken.expiry_timestamp) {
    return cachedUserToken.access_token;
  }

  const refreshToken = process.env.EBAY_REFRESH_TOKEN;
  if (refreshToken) {
    return refreshUserToken();
  }

  const token = process.env.EBAY_USER_TOKEN;
  if (!token) {
    const env = getEnv();
    const envParam = env === "sandbox" ? "sandbox" : "production";
    logger.warn(
      `No EBAY_USER_TOKEN or EBAY_REFRESH_TOKEN found. Visit https://developer.ebay.com/my/auth?env=${envParam} to generate tokens, then add them to .env`,
    );
    return null;
  }
  return token;
}

export async function getAuthToken(): Promise<string> {
  const userToken = await getUserToken();
  if (userToken) {
    return userToken;
  }
  return getAppToken();
}

export function _resetTokenCache(): void {
  cachedAppToken = null;
  cachedUserToken = null;
  tokenRefreshPromise = null;
  userTokenRefreshPromise = null;
}
