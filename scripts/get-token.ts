import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { URL } from "node:url";
import axios from "axios";
import "dotenv/config";

const OAUTH_URLS = {
  sandbox: {
    authorize: "https://auth.sandbox.ebay.com/oauth2/authorize",
    token: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  },
  production: {
    authorize: "https://auth.ebay.com/oauth2/authorize",
    token: "https://api.ebay.com/identity/v1/oauth2/token",
  },
} as const;

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

const CALLBACK_PORT = 3101;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth/callback`;
const ENV_PATH = new URL("../.env", import.meta.url).pathname;

function getConfig() {
  const env = (process.env.EBAY_ENV ?? "sandbox") as "sandbox" | "production";
  if (env !== "sandbox" && env !== "production") {
    throw new Error(`Invalid EBAY_ENV: "${env}"`);
  }

  const prefix = env === "sandbox" ? "EBAY_SANDBOX" : "EBAY_PROD";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const ruName = process.env.EBAY_RU_NAME;

  if (!clientId || !clientSecret) {
    console.error(
      `\u274C Missing ${prefix}_CLIENT_ID or ${prefix}_CLIENT_SECRET in .env`,
    );
    process.exit(1);
  }
  if (!ruName) {
    console.error(
      "\u274C Missing EBAY_RU_NAME in .env.\n" +
        "Set it to the RuName from your eBay Developer Portal:\n" +
        "  Developer Portal \u2192 Your Applications \u2192 OAuth \u2192 RuName",
    );
    process.exit(1);
  }

  return { env, clientId, clientSecret, ruName };
}

function buildConsentUrl(
  env: "sandbox" | "production",
  clientId: string,
  ruName: string,
): string {
  const base = OAUTH_URLS[env].authorize;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: ruName,
    scope: SCOPES,
  });
  return `${base}?${params.toString()}`;
}

async function exchangeCodeForToken(
  env: "sandbox" | "production",
  clientId: string,
  clientSecret: string,
  ruName: string,
  code: string,
): Promise<string> {
  const tokenUrl = OAUTH_URLS[env].token;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await axios.post(
    tokenUrl,
    `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(ruName)}`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
    },
  );

  return response.data.access_token;
}

function writeTokenToEnv(token: string): void {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `EBAY_USER_TOKEN=${token}\n`);
    return;
  }

  let content = readFileSync(ENV_PATH, "utf-8");
  if (content.match(/^EBAY_USER_TOKEN=.*$/m)) {
    content = content.replace(
      /^EBAY_USER_TOKEN=.*$/m,
      `EBAY_USER_TOKEN=${token}`,
    );
  } else {
    content = `${content.trimEnd()}\nEBAY_USER_TOKEN=${token}\n`;
  }
  writeFileSync(ENV_PATH, content);
}

async function main() {
  const { env, clientId, clientSecret, ruName } = getConfig();
  const consentUrl = buildConsentUrl(env, clientId, ruName);

  console.log("\u{1F510} eBay OAuth Token Generator");
  console.log(`Environment: ${env}\n`);
  console.log("Register this redirect URI in your eBay Developer app:");
  console.log(`  ${REDIRECT_URI}\n`);
  console.log("Open this URL in your browser to authorize:");
  console.log(`  ${consentUrl}\n`);
  console.log(`Waiting for OAuth callback on port ${CALLBACK_PORT}...`);

  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith("/oauth/callback")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400);
      res.end("Missing authorization code");
      console.error("\u274C No authorization code in callback");
      return;
    }

    try {
      const token = await exchangeCodeForToken(
        env,
        clientId,
        clientSecret,
        ruName,
        code,
      );
      writeTokenToEnv(token);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h1>Token received!</h1><p>You can close this tab and return to the terminal.</p></body></html>",
      );

      console.log("\n\u2705 Token received and written to .env");
      console.log("You can now start the MCP server.");

      server.close();
      process.exit(0);
    } catch (error) {
      res.writeHead(500);
      res.end("Failed to exchange code for token");
      console.error(
        "\u274C Failed to exchange code:",
        error instanceof Error ? error.message : error,
      );
    }
  });

  server.listen(CALLBACK_PORT);
}

main();
