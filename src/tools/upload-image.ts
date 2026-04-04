import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import axios from "axios";
import { z } from "zod";
import { logger } from "../utils/logger.js";

export const uploadImageSchema = z.object({
  file_path: z
    .string()
    .optional()
    .describe("Absolute path to a local image file (jpg/png/gif/webp)"),
  image_url: z
    .string()
    .optional()
    .describe(
      "URL of an image to download and upload to R2 (preferred over base64)",
    ),
  base64: z.string().optional().describe("Base64-encoded image data"),
  filename: z
    .string()
    .optional()
    .describe(
      "Filename with extension, e.g. item.jpg (required with base64, optional with image_url)",
    ),
});

export const getUploadUrlSchema = z.object({
  filenames: z
    .array(z.string())
    .describe(
      "Array of filenames with extensions, e.g. ['front.jpg', 'back.jpg']. Returns curl commands to upload each file.",
    ),
});

export type UploadImageInput = z.infer<typeof uploadImageSchema>;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

function getMimeType(name: string): string {
  const ext = extname(name).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    throw new Error(
      `Unsupported image extension "${ext}". Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
    );
  }
  return mime;
}

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env",
    );
  }

  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function resolveInput(input: UploadImageInput): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  if (input.file_path) {
    const filePath = input.file_path;
    const filename = basename(filePath);
    logger.info({ filePath, filename }, "Reading image file for upload");
    const buffer = readFileSync(filePath);
    return { buffer, filename };
  }

  if (input.image_url) {
    logger.info({ url: input.image_url }, "Downloading image from URL");
    const response = await axios.get(input.image_url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 20 * 1024 * 1024,
    });

    const contentType = response.headers["content-type"] as string | undefined;
    let filename = input.filename;
    if (!filename) {
      const ext =
        contentType === "image/png"
          ? ".png"
          : contentType === "image/gif"
            ? ".gif"
            : contentType === "image/webp"
              ? ".webp"
              : ".jpg";
      filename = `image-${Date.now()}${ext}`;
    }
    return { buffer: Buffer.from(response.data), filename };
  }

  if (input.base64) {
    if (!input.filename) {
      throw new Error(
        "filename is required when using base64 input. Provide a filename with extension, e.g. item.jpg",
      );
    }
    logger.info(
      { filename: input.filename },
      "Decoding base64 image for upload",
    );
    const buffer = Buffer.from(input.base64, "base64");
    return { buffer, filename: input.filename };
  }

  throw new Error(
    "Provide file_path, image_url, or base64 + filename",
  );
}

export async function uploadImage(
  input: UploadImageInput,
): Promise<{ image_url: string }> {
  const { buffer, filename } = await resolveInput(input);
  const contentType = getMimeType(filename);
  const key = `listings/${Date.now()}-${filename}`;

  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("Missing R2_BUCKET or R2_PUBLIC_URL in .env");
  }

  logger.info(
    { filename, size: buffer.length, key },
    "Uploading image to Cloudflare R2",
  );

  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const imageUrl = `${publicUrl}/${key}`;
  logger.info({ filename, imageUrl }, "Image uploaded to R2");

  return { image_url: imageUrl };
}

export type GetUploadUrlInput = z.infer<typeof getUploadUrlSchema>;

export function getUploadUrl(input: GetUploadUrlInput): {
  instructions: string;
  upload_commands: string[];
} {
  const baseUrl =
    process.env.UPLOAD_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
  const mcpSecret = process.env.MCP_SECRET;
  const authHeader = mcpSecret ? ` -H "Authorization: Bearer ${mcpSecret}"` : "";
  const commands = input.filenames.map(
    (f) =>
      `curl -s -X POST "${baseUrl}/upload?filename=${encodeURIComponent(f)}" --data-binary @/path/to/${f} -H "Content-Type: application/octet-stream"${authHeader}`,
  );

  return {
    instructions: `Use bash to upload each image file with these curl commands. Replace /path/to/<filename> with the actual local file path. Each command returns a JSON response with the public image_url to use in listings.`,
    upload_commands: commands,
  };
}

export async function handleDirectUpload(
  filename: string,
  body: Buffer,
): Promise<{ image_url: string }> {
  const contentType = getMimeType(filename);
  const key = `listings/${Date.now()}-${filename}`;

  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("Missing R2_BUCKET or R2_PUBLIC_URL in .env");
  }

  logger.info(
    { filename, size: body.length, key },
    "Direct upload to Cloudflare R2",
  );

  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const imageUrl = `${publicUrl}/${key}`;
  logger.info({ filename, imageUrl }, "Image uploaded to R2 via direct upload");

  return { image_url: imageUrl };
}
