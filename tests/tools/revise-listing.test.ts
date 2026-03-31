import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviseListing } from "../../src/tools/revise-listing.js";

vi.mock("../../src/ebay/client.js", () => ({
  ebayGet: vi.fn(),
  ebayPut: vi.fn(),
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

function setupOfferLookup() {
  return {
    offers: [
      {
        offerId: "offer-abc",
        availableQuantity: 1,
        pricingSummary: { price: { value: "49.99", currency: "USD" } },
      },
    ],
  };
}

function setupInventoryItem() {
  return {
    condition: "LIKE_NEW",
    conditionDescription: "Old description",
    product: {
      title: "Old Title",
      description: "<p>Old desc</p>",
      aspects: { Brand: ["Apple"] },
      imageUrls: ["https://example.com/img.jpg"],
    },
    availability: {
      shipToLocationAvailability: { quantity: 1 },
    },
  };
}

describe("reviseListing", () => {
  it("should update price only via offer endpoint", async () => {
    const { ebayGet, ebayPut } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce(setupOfferLookup());
    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);

    const result = await reviseListing({
      sku: "TDY-123",
      price: 59.99,
    });

    expect(result.success).toBe(true);
    expect(result.changes).toContain("price updated to $59.99");
    expect(ebayGet).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer?sku=TDY-123&marketplace_id=EBAY_US",
    );
    expect(ebayPut).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer/offer-abc",
      expect.objectContaining({
        pricingSummary: {
          price: { value: "59.99", currency: "USD" },
        },
      }),
    );
  });

  it("should update title only via inventory item endpoint", async () => {
    const { ebayGet, ebayPut } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce(setupInventoryItem());
    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);

    const result = await reviseListing({
      sku: "TDY-456",
      title: "New Title Here",
    });

    expect(result.success).toBe(true);
    expect(result.changes).toContain("title updated");
    expect(ebayPut).toHaveBeenCalledWith(
      "/sell/inventory/v1/inventory_item/TDY-456",
      expect.objectContaining({
        product: expect.objectContaining({
          title: "New Title Here",
        }),
      }),
    );
  });

  it("should update both price and title in parallel", async () => {
    const { ebayGet, ebayPut } = await import("../../src/ebay/client.js");
    // First call: offer lookup for price update; second call: inventory item for title update
    vi.mocked(ebayGet)
      .mockResolvedValueOnce(setupOfferLookup())
      .mockResolvedValueOnce(setupInventoryItem());
    vi.mocked(ebayPut)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await reviseListing({
      sku: "TDY-789",
      price: 19.99,
      title: "Updated Title",
    });

    expect(result.success).toBe(true);
    expect(result.changes).toContain("price updated to $19.99");
    expect(result.changes).toContain("title updated");
    expect(ebayGet).toHaveBeenCalledTimes(2);
    expect(ebayPut).toHaveBeenCalledTimes(2);
  });

  it("should throw when no offer found for SKU", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({ offers: [] });

    await expect(
      reviseListing({ sku: "TDY-MISSING", price: 10 }),
    ).rejects.toThrow("No offer found for SKU TDY-MISSING");
  });

  it("should return no changes when nothing is requested", async () => {
    const result = await reviseListing({ sku: "TDY-NOOP" });

    expect(result.success).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.message).toContain("no changes requested");
  });

  it("should include all changes in the message", async () => {
    const { ebayGet, ebayPut } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet)
      .mockResolvedValueOnce(setupOfferLookup())
      .mockResolvedValueOnce(setupInventoryItem());
    vi.mocked(ebayPut)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await reviseListing({
      sku: "TDY-100",
      price: 25,
      quantity: 3,
      description: "<p>New</p>",
      condition_description: "Mint",
    });

    expect(result.message).toContain("TDY-100");
    expect(result.changes).toContain("price updated to $25.00");
    expect(result.changes).toContain("quantity updated to 3");
    expect(result.changes).toContain("description updated");
    expect(result.changes).toContain("condition description updated");
  });
});
