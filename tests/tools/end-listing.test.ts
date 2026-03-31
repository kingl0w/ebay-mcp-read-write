import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endListing } from "../../src/tools/end-listing.js";

vi.mock("../../src/ebay/client.js", () => ({
  ebayGet: vi.fn(),
  ebayPost: vi.fn(),
  ebayDelete: vi.fn(),
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
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("endListing", () => {
  it("should withdraw and delete an active listing", async () => {
    const { ebayGet, ebayPost, ebayDelete } = await import(
      "../../src/ebay/client.js"
    );
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [{ offerId: "offer-abc", status: "ACTIVE" }],
    });
    vi.mocked(ebayPost).mockResolvedValueOnce({});
    vi.mocked(ebayDelete).mockResolvedValueOnce(undefined);

    const result = await endListing({
      sku: "TDY-123",
      reason: "NOT_AVAILABLE",
    });

    expect(result.success).toBe(true);
    expect(result.sku).toBe("TDY-123");
    expect(result.offer_id).toBe("offer-abc");
    expect(result.message).toContain("Ended listing for SKU TDY-123");

    expect(ebayPost).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer/offer-abc/withdraw",
      {},
    );
    expect(ebayDelete).toHaveBeenCalledWith(
      "/sell/inventory/v1/inventory_item/TDY-123",
    );
  });

  it("should return early if offer is already inactive", async () => {
    const { ebayGet, ebayPost, ebayDelete } = await import(
      "../../src/ebay/client.js"
    );
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [{ offerId: "offer-xyz", status: "INACTIVE" }],
    });

    const result = await endListing({
      sku: "TDY-456",
      reason: "OTHER",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("already inactive");
    expect(ebayPost).not.toHaveBeenCalled();
    expect(ebayDelete).not.toHaveBeenCalled();
  });

  it("should look up the correct offer by SKU", async () => {
    const { ebayGet, ebayPost, ebayDelete } = await import(
      "../../src/ebay/client.js"
    );
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [{ offerId: "offer-999", status: "PUBLISHED" }],
    });
    vi.mocked(ebayPost).mockResolvedValueOnce({});
    vi.mocked(ebayDelete).mockResolvedValueOnce(undefined);

    await endListing({ sku: "TDY-789", reason: "LOST_OR_BROKEN" });

    expect(ebayGet).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer?sku=TDY-789&marketplace_id=EBAY_US",
    );
  });

  it("should throw when no offer found for SKU", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({ offers: [] });

    await expect(
      endListing({ sku: "TDY-GONE", reason: "NOT_AVAILABLE" }),
    ).rejects.toThrow("No offer found for SKU TDY-GONE");
  });

  it("should also withdraw offers with PUBLISHED status", async () => {
    const { ebayGet, ebayPost, ebayDelete } = await import(
      "../../src/ebay/client.js"
    );
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [{ offerId: "offer-pub", status: "PUBLISHED" }],
    });
    vi.mocked(ebayPost).mockResolvedValueOnce({});
    vi.mocked(ebayDelete).mockResolvedValueOnce(undefined);

    const result = await endListing({
      sku: "TDY-PUB",
      reason: "INCORRECT_ITEM_INFO",
    });

    expect(result.success).toBe(true);
    expect(ebayPost).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer/offer-pub/withdraw",
      {},
    );
  });
});
