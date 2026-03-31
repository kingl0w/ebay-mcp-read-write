import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadImage } from "../../src/tools/upload-image.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: class MockS3Client {
      send = mockSend;
    },
    PutObjectCommand: class MockPutObjectCommand {
      constructor(public readonly input: Record<string, unknown>) {
        Object.assign(this, input);
      }
    },
  };
});

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
  process.env = {
    ...originalEnv,
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET: "test-bucket",
    R2_PUBLIC_URL: "https://images.example.com",
  };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("uploadImage — file_path mode", () => {
  it("should upload an image to R2 and return the public URL", async () => {
    const { readFileSync } = await import("node:fs");

    const fakeBuffer = Buffer.from("fake-image-data");
    vi.mocked(readFileSync).mockReturnValueOnce(fakeBuffer);
    mockSend.mockResolvedValueOnce({});

    const result = await uploadImage({ file_path: "/tmp/photos/item.jpg" });

    expect(result.image_url).toMatch(
      /^https:\/\/images\.example\.com\/listings\/\d+-item\.jpg$/,
    );
    expect(readFileSync).toHaveBeenCalledWith("/tmp/photos/item.jpg");
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: expect.stringMatching(/^listings\/\d+-item\.jpg$/),
        Body: fakeBuffer,
        ContentType: "image/jpeg",
      }),
    );
  });

  it("should throw when the file cannot be read", async () => {
    const { readFileSync } = await import("node:fs");

    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    await expect(
      uploadImage({ file_path: "/tmp/does-not-exist.jpg" }),
    ).rejects.toThrow("ENOENT: no such file or directory");
  });

  it("should throw for unsupported file extensions", async () => {
    await expect(
      uploadImage({ file_path: "/tmp/photos/doc.pdf" }),
    ).rejects.toThrow('Unsupported image extension ".pdf"');
  });

  it("should detect correct MIME types for all supported extensions", async () => {
    const { readFileSync } = await import("node:fs");

    for (const [ext, expectedType] of [
      [".png", "image/png"],
      [".webp", "image/webp"],
      [".gif", "image/gif"],
      [".jpeg", "image/jpeg"],
    ]) {
      vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from("img"));
      mockSend.mockResolvedValueOnce({});

      await uploadImage({ file_path: `/tmp/photo${ext}` });

      expect(mockSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ ContentType: expectedType }),
      );
    }
  });

  it("should throw when R2 upload fails", async () => {
    const { readFileSync } = await import("node:fs");

    vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from("data"));
    mockSend.mockRejectedValueOnce(new Error("R2 upload failed"));

    await expect(
      uploadImage({ file_path: "/tmp/photos/bad.png" }),
    ).rejects.toThrow("R2 upload failed");
  });
});

describe("uploadImage — base64 mode", () => {
  it("should decode base64 and upload to R2", async () => {
    const imageData = Buffer.from("fake-png-bytes");
    const base64 = imageData.toString("base64");
    mockSend.mockResolvedValueOnce({});

    const result = await uploadImage({
      base64,
      filename: "photo.png",
    });

    expect(result.image_url).toMatch(
      /^https:\/\/images\.example\.com\/listings\/\d+-photo\.png$/,
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: expect.stringMatching(/^listings\/\d+-photo\.png$/),
        Body: imageData,
        ContentType: "image/png",
      }),
    );
  });

  it("should throw for unsupported filename extension", async () => {
    await expect(
      uploadImage({ base64: "abc123", filename: "file.bmp" }),
    ).rejects.toThrow('Unsupported image extension ".bmp"');
  });

  it("should throw when base64 is provided without filename", async () => {
    await expect(uploadImage({ base64: "abc123" })).rejects.toThrow(
      "filename is required when using base64 input",
    );
  });
});

describe("uploadImage — validation", () => {
  it("should throw when neither file_path nor base64 is provided", async () => {
    await expect(uploadImage({})).rejects.toThrow(
      "Provide file_path, image_url, or base64 + filename",
    );
  });
});
