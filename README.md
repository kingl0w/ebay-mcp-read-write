# ebay-mcp-server

**MCP server for eBay listing management — create and manage eBay listings with AI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-73%20passing-brightgreen)](#development)

## What it does

An [MCP](https://modelcontextprotocol.io/) server that lets Claude (or any MCP client) create and manage eBay listings. Upload product photos, tell Claude what you're selling and your price — it drafts a complete listing with title, description, item specifics, condition, and category, then posts it directly to eBay.

Works with **Claude Desktop** (stdio transport) and **claude.ai** (remote HTTP transport).

## Workflow

```
Photos → Claude (vision analysis) → draft_listing → review/edit → create_listing → live on eBay
```

1. Upload product photos to Claude for identification
2. Upload the same photos via the built-in web uploader (`/images`) to get hosted URLs
3. Tell Claude what to list and at what price
4. Claude drafts the listing — review and approve
5. Claude posts it live to eBay with images

## Tools

| Tool | Description |
| --- | --- |
| `draft_listing` | Format structured product data into an eBay listing draft (title, description, condition, category, item specifics) |
| `create_listing` | Post a finalized draft to eBay via Inventory API (3-step: inventory item → offer → publish) |
| `get_listings` | Retrieve active/inactive listings with pagination, titles, prices, and direct eBay URLs |
| `revise_listing` | Update price, quantity, title, or description on an existing listing (experimental — some categories may require end/relist) |
| `end_listing` | Withdraw and delete an active listing |
| `upload_image` | Upload product images to cloud storage (Cloudflare R2) and return public URLs for listings |
| `get_upload_url` | Get curl commands for uploading local images directly to R2 |

## Image hosting

The server includes a built-in **drag-and-drop image upload page** at `/images`. Open it in your browser, drop your product photos, and get back public URLs to use in listings.

Images are stored in Cloudflare R2 (S3-compatible). You can also upload programmatically via `POST /upload?filename=photo.jpg` with raw binary body.

## Prerequisites

- **Node 20+** and **pnpm**
- **eBay Developer account** — free at [developer.ebay.com](https://developer.ebay.com)
- **eBay seller account** with business policies configured (fulfillment, payment, return)
- **Cloudflare R2 bucket** — for image hosting (free tier available)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/aetnios/ebay-mcp-server.git
cd ebay-mcp-server
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your credentials (see [Environment variables](#environment-variables) below).

### 3. Register OAuth redirect URI

Go to [eBay Developer Portal](https://developer.ebay.com) → **My Apps** → select your application → **OAuth** → **Add redirect URI**:

```
http://localhost:3101/oauth/callback
```

Copy the **RuName** value into `EBAY_RU_NAME` in your `.env`.

### 4. Generate a user token

```bash
pnpm get-token
```

Opens the eBay OAuth consent flow. Follow the printed URL, authorize in your browser, and the token is written to `.env` automatically.

> **Important:** Wrap the `EBAY_USER_TOKEN` and `EBAY_REFRESH_TOKEN` values in double quotes in your `.env` file — the `#` characters in eBay tokens are interpreted as comments by dotenv otherwise.

The access token expires every 2 hours. The server automatically refreshes it using the refresh token (which lasts ~18 months).

### 5. Set up business policies

In [Seller Hub](https://www.ebay.com/sh/settings) → **Account** → **Business Policies**, find your policy IDs and add them to `.env`:

```
EBAY_FULFILLMENT_POLICY_ID=your-fulfillment-id
EBAY_PAYMENT_POLICY_ID=your-payment-id
EBAY_RETURN_POLICY_ID=your-return-id
EBAY_MERCHANT_LOCATION_KEY=your-location-key
```

### 6. Set up Cloudflare R2

1. Create an R2 bucket in your [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Create an R2 API token with **Object Read & Write** permissions
3. Set up a public custom domain for the bucket (or use R2's public URL)
4. Add credentials to `.env`:

```
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_URL=https://images.yourdomain.com
```

### 7. Start the server

```bash
pnpm dev          # Development with hot reload
# or
pnpm build && pnpm start  # Production
# or
docker compose up -d      # Docker on port 3100
```

## Connecting to Claude

### claude.ai (Remote HTTP)

1. Deploy the server to a public URL (e.g., behind nginx/Caddy with HTTPS)
2. In claude.ai → **Settings** → **Integrations**, add a new MCP connection
3. Enter your server's MCP endpoint URL: `https://your-domain.com/mcp`
4. The server exposes tools automatically via Streamable HTTP transport

### Claude Desktop (stdio)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ebay": {
      "command": "node",
      "args": ["/path/to/ebay-mcp-server/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "EBAY_ENV": "production",
        "EBAY_USER_TOKEN": "your-token",
        "EBAY_REFRESH_TOKEN": "your-refresh-token",
        "EBAY_PROD_CLIENT_ID": "your-client-id",
        "EBAY_PROD_CLIENT_SECRET": "your-client-secret",
        "EBAY_FULFILLMENT_POLICY_ID": "your-fulfillment-id",
        "EBAY_PAYMENT_POLICY_ID": "your-payment-id",
        "EBAY_RETURN_POLICY_ID": "your-return-id",
        "EBAY_MERCHANT_LOCATION_KEY": "your-location-key",
        "R2_ACCOUNT_ID": "your-r2-account",
        "R2_ACCESS_KEY_ID": "your-r2-key",
        "R2_SECRET_ACCESS_KEY": "your-r2-secret",
        "R2_BUCKET": "your-bucket",
        "R2_PUBLIC_URL": "https://images.yourdomain.com"
      }
    }
  }
}
```

Build first with `pnpm build`.

## Security

### Bearer Token Authentication

Set `MCP_SECRET` to protect the `/mcp` endpoint:

```bash
openssl rand -hex 32
```

Add to `.env`:

```
MCP_SECRET=<your-secret>
```

When set, all requests to `/mcp` require `Authorization: Bearer <MCP_SECRET>`. The `/health` and `/images` endpoints are unauthenticated.

### Security Headers

[Helmet](https://helmetjs.github.io/) provides standard security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.).

## Resilience features

- **Automatic token refresh** — user access tokens are refreshed automatically using the refresh token
- **Retry with exponential backoff** — eBay API calls retry up to 3 times on transient failures (429, 500, 502, 503, 504)
- **Request timeouts** — 30-second timeout on all eBay API calls
- **Orphan cleanup** — if listing creation fails mid-way, partially created inventory items and offers are cleaned up
- **Concurrent token refresh protection** — prevents duplicate token refresh requests under load

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `EBAY_ENV` | Yes | `sandbox` or `production` |
| `EBAY_SANDBOX_CLIENT_ID` | If sandbox | App client ID ([Developer Portal](https://developer.ebay.com)) |
| `EBAY_SANDBOX_CLIENT_SECRET` | If sandbox | App client secret |
| `EBAY_PROD_CLIENT_ID` | If production | App client ID |
| `EBAY_PROD_CLIENT_SECRET` | If production | App client secret (Cert ID) |
| `EBAY_RU_NAME` | Yes | OAuth redirect URI name |
| `EBAY_USER_TOKEN` | Yes | User OAuth token (via `pnpm get-token`) — **wrap in quotes** |
| `EBAY_REFRESH_TOKEN` | Recommended | Refresh token for auto-renewal — **wrap in quotes** |
| `EBAY_FULFILLMENT_POLICY_ID` | Yes | Fulfillment policy ([Seller Hub](https://www.ebay.com/sh/settings)) |
| `EBAY_PAYMENT_POLICY_ID` | Yes | Payment policy |
| `EBAY_RETURN_POLICY_ID` | Yes | Return policy |
| `EBAY_MERCHANT_LOCATION_KEY` | Yes | Merchant location key |
| `R2_ACCOUNT_ID` | For images | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | For images | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | For images | R2 API token secret |
| `R2_BUCKET` | For images | R2 bucket name |
| `R2_PUBLIC_URL` | For images | Public URL for the R2 bucket |
| `UPLOAD_BASE_URL` | For images | Public base URL of your server (for upload URL generation) |
| `MCP_SECRET` | No | Bearer token for `/mcp` endpoint auth |
| `MCP_TRANSPORT` | No | `http` (default) or `stdio` |
| `PORT` | No | Server port (default `3100`) |
| `LOG_LEVEL` | No | Pino log level (default `info`) |

## Docker

```bash
docker compose up --build -d
```

Multi-stage Alpine build. Runs on port 3100. Reads credentials from `.env`.

## Development

```bash
pnpm dev        # Watch mode with hot reload (tsx)
pnpm build      # Production build (tsup → dist/)
pnpm test       # 73 tests via vitest
pnpm lint       # Biome linter + formatter
pnpm start      # Run production build
pnpm get-token  # Generate eBay OAuth user token
```

### Stack

- **Runtime:** Node 20, TypeScript (ES2022, NodeNext)
- **MCP:** `@modelcontextprotocol/sdk` with stdio + Streamable HTTP transports
- **eBay API:** Inventory API via axios with retry logic
- **Image hosting:** Cloudflare R2 via AWS S3 SDK
- **Validation:** zod for all tool input schemas
- **Logging:** pino (with pino-pretty in dev)
- **Build:** tsup (ESM), tsx for dev
- **Test:** vitest
- **Lint/Format:** biome (2-space indent, double quotes, semicolons)

## Known limitations

- **claude.ai image uploads:** MCP tool call payloads on claude.ai have a size limit that's too small for base64 image data. Use the built-in `/images` web uploader instead — upload photos there, then paste the URLs to Claude.
- **eBay condition codes:** Some eBay categories only accept specific condition values. If a condition is rejected, try `EXCELLENT`, `LIKE_NEW`, or `NEW`.
- **Revise listing:** The `revise_listing` tool works for simple updates (price, quantity) but may fail for some categories or field combinations. Workaround: end the listing and create a new one.
- **Sandbox vs Production:** Sandbox credentials work differently from production. For real listings, use `EBAY_ENV=production` with production credentials.

## License

[MIT](LICENSE)
