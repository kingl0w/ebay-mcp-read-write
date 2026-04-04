import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createListing, createListingSchema } from "./tools/create-listing.js";
import { draftListing, draftListingSchema } from "./tools/draft-listing.js";
import { endListing, endListingSchema } from "./tools/end-listing.js";
import {
  getCategoryAspects,
  getCategoryAspectsSchema,
} from "./tools/get-category-aspects.js";
import { getListings, getListingsSchema } from "./tools/get-listings.js";
import { reviseListing, reviseListingSchema } from "./tools/revise-listing.js";
import {
  searchCategories,
  searchCategoriesSchema,
} from "./tools/search-categories.js";
import {
  getUploadUrl,
  getUploadUrlSchema,
  handleDirectUpload,
  uploadImage,
  uploadImageSchema,
} from "./tools/upload-image.js";
import { logger } from "./utils/logger.js";

function sanitizeInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...input };
  if ("token" in sanitized) sanitized.token = "[REDACTED]";
  if ("EBAY_USER_TOKEN" in sanitized) sanitized.EBAY_USER_TOKEN = "[REDACTED]";
  return sanitized;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "ebay-mcp",
    version: "0.1.0",
  });

  server.tool(
    "draft_listing",
    "Format structured product data into an eBay listing draft. The client (Claude) analyzes images directly — pass the resulting product details here.",
    draftListingSchema.shape,
    async (params) => {
      logger.info(
        { tool: "draft_listing", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = draftListing(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: draft_listing",
        );
        throw error;
      }
    },
  );

  server.tool(
    "create_listing",
    "Create a new eBay listing via the Inventory API from a finalized draft",
    createListingSchema.shape,
    async (params) => {
      logger.info(
        { tool: "create_listing", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = await createListing(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: create_listing",
        );
        throw error;
      }
    },
  );

  server.tool(
    "get_listings",
    "Retrieve active eBay listings with pagination",
    getListingsSchema.shape,
    async (params) => {
      logger.info(
        { tool: "get_listings", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = await getListings(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: get_listings",
        );
        throw error;
      }
    },
  );

  server.tool(
    "revise_listing",
    "Update an existing eBay listing (title, description, price, images, etc.)",
    reviseListingSchema.shape,
    async (params) => {
      logger.info(
        { tool: "revise_listing", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = await reviseListing(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: revise_listing",
        );
        throw error;
      }
    },
  );

  server.tool(
    "end_listing",
    "End/remove an active eBay listing",
    endListingSchema.shape,
    async (params) => {
      logger.info(
        { tool: "end_listing", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = await endListing(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: end_listing",
        );
        throw error;
      }
    },
  );

  server.tool(
    "upload_image",
    "Upload a product image to cloud storage (Cloudflare R2) and return a public URL for use in eBay listings. Accepts base64 (with filename), image_url, or file_path. For base64: resize images to max 800x600 and compress to JPEG quality 60 so base64 is under 50KB, then pass with a filename. Use Python PIL to resize before encoding.",
    uploadImageSchema.shape,
    async (params) => {
      logger.info(
        { tool: "upload_image", input: sanitizeInput(params) },
        "Tool called",
      );
      try {
        const result = await uploadImage(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: sanitizeInput(params) },
          "Tool execution failed: upload_image",
        );
        throw error;
      }
    },
  );

  server.tool(
    "get_upload_url",
    "Get curl commands to upload local image files directly to cloud storage. Use this when you have local image files (e.g. /mnt/user-data/uploads/photo.jpg) that need to be uploaded to R2 for eBay listings. Run the returned curl commands in bash, then use the returned image_url values in your listing.",
    getUploadUrlSchema.shape,
    async (params) => {
      logger.info({ tool: "get_upload_url", input: params }, "Tool called");
      try {
        const result = getUploadUrl(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: params },
          "Tool execution failed: get_upload_url",
        );
        throw error;
      }
    },
  );

  server.tool(
    "search_categories",
    "Search for eBay category IDs by product name or keywords. Use this to find the correct category_id before creating a listing or fetching category-specific item specifics.",
    searchCategoriesSchema.shape,
    async (params) => {
      logger.info({ tool: "search_categories", input: params }, "Tool called");
      try {
        const result = await searchCategories(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: params },
          "Tool execution failed: search_categories",
        );
        throw error;
      }
    },
  );

  server.tool(
    "get_category_aspects",
    "Get required, recommended, and optional item specifics for an eBay category. Use this after identifying the category to know exactly which attributes (Brand, Size, Color, UPC, etc.) to extract from product images.",
    getCategoryAspectsSchema.shape,
    async (params) => {
      logger.info(
        { tool: "get_category_aspects", input: params },
        "Tool called",
      );
      try {
        const result = await getCategoryAspects(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(
          { error, input: params },
          "Tool execution failed: get_category_aspects",
        );
        throw error;
      }
    },
  );

  return server;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("eBay MCP server started on stdio");
}

async function startHttp() {
  const app = express();
  app.set("trust proxy", 1);
  const port = Number(process.env.PORT ?? 3100);
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const sseSessions = new Map<string, SSEServerTransport>();

  app.use(helmet({ contentSecurityPolicy: false }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Mcp-Session-Id, Authorization",
    );
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path === "/upload") {
      next();
      return;
    }
    express.json({ limit: "50mb" })(req, res, next);
  });

  const mcpSecret = process.env.MCP_SECRET;
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!mcpSecret) {
      next();
      return;
    }
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${mcpSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  if (mcpSecret) {
    app.use("/mcp", requireAuth);
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "http", version: "0.1.0" });
  });

  app.get("/images", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html><head><title>Image Upload</title>
<style>
body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}
#auth{margin:40px 0;text-align:center}
#auth input{padding:10px;width:300px;border:1px solid #ccc;border-radius:6px;font-size:14px}
#auth button{padding:10px 20px;margin-left:8px;border:none;background:#4CAF50;color:#fff;border-radius:6px;cursor:pointer;font-size:14px}
#auth .error{color:#f44336;margin-top:8px}
#app{display:none}
#drop{border:3px dashed #ccc;border-radius:12px;padding:60px 20px;text-align:center;margin:20px 0;cursor:pointer;transition:.2s}
#drop.over{border-color:#4CAF50;background:#f0fff0}
#drop input{display:none}
#results{margin-top:20px}
.url-box{background:#f5f5f5;padding:10px;border-radius:6px;margin:8px 0;word-break:break-all;font-family:monospace;font-size:13px;cursor:pointer}
.url-box:hover{background:#e8e8e8}
.success{color:#4CAF50;font-weight:bold}
.error{color:#f44336}
img.preview{max-width:200px;max-height:150px;margin:5px;border-radius:4px}
</style></head><body>
<h2>📸 Upload Images to R2</h2>
<div id="auth">
<p>Enter your upload token to continue.</p>
<input type="password" id="token" placeholder="Token" onkeydown="if(event.key==='Enter')doAuth()">
<button onclick="doAuth()">Unlock</button>
<div id="auth-error"></div>
</div>
<div id="app">
<p>Drag & drop images here, or click to select. URLs will be copied to clipboard.</p>
<div id="drop" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="handleDrop(event)" onclick="this.querySelector('input').click()">
<input type="file" multiple accept="image/*" onchange="handleFiles(this.files)">
<p>📁 Drop images here or click to browse</p>
</div>
<div id="results"></div>
</div>
<script>
let authToken=sessionStorage.getItem('upload_token')||'';
if(authToken)showApp();
function doAuth(){
  authToken=document.getElementById('token').value.trim();
  if(!authToken){document.getElementById('auth-error').textContent='Token required';return}
  fetch('/upload?filename=test.ping',{method:'POST',headers:{'Authorization':'Bearer '+authToken,'Content-Type':'application/octet-stream'},body:new ArrayBuffer(0)}).then(r=>{
    if(r.status===401){document.getElementById('auth-error').textContent='Invalid token';return}
    sessionStorage.setItem('upload_token',authToken);showApp();
  }).catch(()=>{document.getElementById('auth-error').textContent='Connection error'});
}
function showApp(){document.getElementById('auth').style.display='none';document.getElementById('app').style.display='block'}
function handleDrop(e){e.preventDefault();document.getElementById('drop').classList.remove('over');handleFiles(e.dataTransfer.files)}
async function handleFiles(files){
  const results=document.getElementById('results');
  for(const file of files){
    const div=document.createElement('div');
    const img=document.createElement('img');img.className='preview';img.src=URL.createObjectURL(file);
    div.appendChild(img);
    div.innerHTML+='<br>Uploading '+file.name+'...';
    results.prepend(div);
    try{
      const buf=await file.arrayBuffer();
      const r=await fetch('/upload?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','Authorization':'Bearer '+authToken},body:buf});
      if(r.status===401){div.innerHTML+='<br><span class="error">Token expired — reload page</span>';return}
      const j=await r.json();
      if(j.image_url){
        div.innerHTML='';div.appendChild(img);
        div.innerHTML+='<span class="success">✓ Uploaded!</span><div class="url-box" onclick="navigator.clipboard.writeText(this.textContent).then(()=>alert(\\'Copied!\\'))">'+j.image_url+'</div>';
      }else{div.innerHTML+='<br><span class="error">Error: '+(j.error||'Unknown')+'</span>'}
    }catch(err){div.innerHTML+='<br><span class="error">Failed: '+err.message+'</span>'}
  }
}
</script></body></html>`);
  });

  app.post(
    "/upload",
    requireAuth,
    express.raw({
      type: ["application/octet-stream", "image/*"],
      limit: "20mb",
    }),
    async (req, res) => {
      try {
        const filename = req.query.filename as string;
        if (!filename) {
          res.status(400).json({ error: "Missing ?filename= query parameter" });
          return;
        }
        const result = await handleDirectUpload(filename, req.body as Buffer);
        res.json(result);
      } catch (error) {
        logger.error({ error }, "Direct upload failed");
        res.status(500).json({
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    },
  );

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport as StreamableHTTPServerTransport);
          logger.debug({ sessionId: id }, "Session created");
        },
      });
      transport.onclose = () => {
        for (const [id, t] of sessions) {
          if (t === transport) {
            sessions.delete(id);
            logger.debug({ sessionId: id }, "Session closed");
            break;
          }
        }
      };
      const server = createServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({ error: "No session" });
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (transport) {
      await transport.close();
      sessions.delete(sessionId as string);
      logger.debug({ sessionId }, "Session terminated by client");
    }
    res.status(200).end();
  });

  // SSE transport (deprecated protocol version 2024-11-05, needed for claude.ai)
  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, transport);
    logger.debug({ sessionId: transport.sessionId }, "SSE session created");

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      logger.debug({ sessionId: transport.sessionId }, "SSE session closed");
    });

    const server = createServer();
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: "No SSE session found for sessionId" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  app.listen(port, "127.0.0.1", () => {
    logger.info(
      { port, transport: "http+sse" },
      `eBay MCP server started on http://localhost:${port}`,
    );
    logger.info(`Streamable HTTP endpoint: http://localhost:${port}/mcp`);
    logger.info(`SSE endpoint: http://localhost:${port}/sse`);
    logger.info(`SSE message endpoint: http://localhost:${port}/messages`);
  });
}

async function main() {
  const transportMode = process.env.MCP_TRANSPORT ?? "http";
  if (transportMode === "stdio") {
    await startStdio();
  } else {
    await startHttp();
  }
}

main().catch((error) => {
  logger.fatal(error, "Failed to start eBay MCP server");
  process.exit(1);
});
