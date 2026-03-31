import { readFile } from "node:fs/promises";
import type { ImageBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { logger } from "./logger.js";

export async function imageToBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return buffer.toString("base64");
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export function getMediaType(filePath: string): ImageMediaType {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      logger.warn({ ext }, "Unknown image extension, defaulting to jpeg");
      return "image/jpeg";
  }
}

function parseBase64(base64: string): {
  data: string;
  mediaType: ImageMediaType;
} {
  const dataUriMatch = base64.match(
    /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/,
  );
  if (dataUriMatch) {
    return {
      data: dataUriMatch[2],
      mediaType: dataUriMatch[1] as ImageMediaType,
    };
  }
  return { data: base64, mediaType: "image/jpeg" };
}

export function toAnthropicImageBlock(base64: string): ImageBlockParam {
  const { data, mediaType } = parseBase64(base64);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data,
    },
  };
}
