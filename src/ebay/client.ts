import axios, { type AxiosError, type AxiosInstance } from "axios";
import { logger } from "../utils/logger.js";
import { getAuthToken } from "./auth.js";
import type { EbayEnvironment, EbayErrorResponse } from "./types.js";

const REQUEST_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const BASE_URLS: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com",
  production: "https://api.ebay.com",
};

let client: AxiosInstance | null = null;
let clientEnv: EbayEnvironment | null = null;

function getEnv(): EbayEnvironment {
  const env = process.env.EBAY_ENV ?? "sandbox";
  if (env !== "sandbox" && env !== "production") {
    throw new Error(
      `Invalid EBAY_ENV: "${env}". Must be "sandbox" or "production".`,
    );
  }
  return env;
}

export function getClient(): AxiosInstance {
  const env = getEnv();

  if (client && clientEnv === env) {
    return client;
  }

  const instance = axios.create({
    baseURL: BASE_URLS[env],
    timeout: REQUEST_TIMEOUT,
  });

  instance.interceptors.request.use(async (config) => {
    const token = await getAuthToken();
    config.headers.Authorization = `Bearer ${token}`;
    config.headers["Content-Type"] = "application/json";
    config.headers["Content-Language"] = "en-US";
    config.headers["Accept-Language"] = "en-US";
    config.headers["X-EBAY-C-MARKETPLACE-ID"] = "EBAY_US";
    logger.debug(
      { method: config.method, url: config.url },
      "eBay API request",
    );
    return config;
  });

  instance.interceptors.response.use(
    (res) => {
      logger.debug(
        { status: res.status, url: res.config.url },
        "eBay API response",
      );
      return res;
    },
    (error) => {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          logger.error(
            "eBay auth failed — check EBAY_USER_TOKEN or credentials",
          );
        }
        const ebayErrors = error.response?.data as
          | EbayErrorResponse
          | undefined;
        if (ebayErrors?.errors) {
          logger.error(
            { errors: ebayErrors.errors },
            "eBay API error response",
          );
        } else {
          logger.error(
            {
              status: error.response?.status,
              data: error.response?.data,
              url: error.config?.url,
            },
            "eBay API error",
          );
        }
      }
      throw error;
    },
  );

  client = instance;
  clientEnv = env;
  return instance;
}

function isRetryable(error: AxiosError): boolean {
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return true;
  if (!error.response) return true;
  return RETRYABLE_STATUS_CODES.has(error.response.status);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        attempt < MAX_RETRIES - 1 &&
        axios.isAxiosError(error) &&
        isRetryable(error)
      ) {
        const delay = RETRY_BASE_DELAY * 2 ** attempt;
        logger.warn(
          { attempt: attempt + 1, delay, url: error.config?.url },
          "Retrying eBay API request",
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function ebayGet<T>(path: string): Promise<T> {
  return withRetry(async () => {
    const res = await getClient().get<T>(path);
    return res.data;
  });
}

export async function ebayPost<T>(path: string, body: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await getClient().post<T>(path, body);
    return res.data;
  });
}

export async function ebayPut<T>(path: string, body: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await getClient().put<T>(path, body);
    return res.data;
  });
}

export async function ebayDelete(path: string): Promise<void> {
  return withRetry(async () => {
    await getClient().delete(path);
  });
}

export function _resetClient(): void {
  client = null;
  clientEnv = null;
}
