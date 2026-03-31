import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getListings } from "../../src/tools/get-listings.js";

vi.mock("../../src/ebay/client.js", () => ({
  ebayGet: vi.fn(),
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

function makeOffer(
  overrides: Partial<{
    offerId: string;
    sku: string;
    status: string;
    listingId: string | null;
    price: string;
    quantity: number;
  }> = {},
) {
  const {
    offerId = "offer-1",
    sku = "TDY-123",
    status = "ACTIVE",
    listingId = "listing-1",
    price = "29.99",
    quantity = 1,
  } = overrides;
  return {
    offerId,
    sku,
    status,
    listing: listingId ? { listingId } : undefined,
    pricingSummary: { price: { value: price, currency: "USD" } },
    availableQuantity: quantity,
  };
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, EBAY_ENV: "sandbox" };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getListings", () => {
  it("should filter by ACTIVE status", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [
        makeOffer({ offerId: "o1", status: "ACTIVE" }),
        makeOffer({ offerId: "o2", status: "INACTIVE" }),
        makeOffer({ offerId: "o3", status: "ACTIVE" }),
      ],
      total: 3,
      size: 3,
      limit: 25,
      offset: 0,
    });

    const result = await getListings({
      status: "ACTIVE",
      limit: 25,
      offset: 0,
    });

    expect(result.returned).toBe(2);
    expect(result.listings.every((l) => l.status === "ACTIVE")).toBe(true);
  });

  it("should return all listings when status is ALL", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [
        makeOffer({ status: "ACTIVE" }),
        makeOffer({ offerId: "o2", status: "INACTIVE" }),
      ],
      total: 2,
      size: 2,
      limit: 25,
      offset: 0,
    });

    const result = await getListings({ status: "ALL", limit: 25, offset: 0 });

    expect(result.returned).toBe(2);
  });

  it("should pass pagination params correctly", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [],
      total: 0,
      size: 0,
      limit: 10,
      offset: 20,
    });

    await getListings({ status: "ACTIVE", limit: 10, offset: 20 });

    expect(ebayGet).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=10&offset=20",
    );
  });

  it("should include URL only when listing_id exists", async () => {
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [
        makeOffer({ offerId: "o1", listingId: "L123" }),
        makeOffer({ offerId: "o2", listingId: null }),
      ],
      total: 2,
      size: 2,
      limit: 25,
      offset: 0,
    });

    const result = await getListings({ status: "ALL", limit: 25, offset: 0 });

    expect(result.listings[0].listing_id).toBe("L123");
    expect(result.listings[0].url).toBe(
      "https://www.sandbox.ebay.com/itm/L123",
    );
    expect(result.listings[1].listing_id).toBeNull();
    expect(result.listings[1].url).toBeNull();
  });

  it("should use production URL when EBAY_ENV=production", async () => {
    process.env.EBAY_ENV = "production";
    const { ebayGet } = await import("../../src/ebay/client.js");
    vi.mocked(ebayGet).mockResolvedValueOnce({
      offers: [makeOffer({ listingId: "P999" })],
      total: 1,
      size: 1,
      limit: 25,
      offset: 0,
    });

    const result = await getListings({ status: "ALL", limit: 25, offset: 0 });

    expect(result.listings[0].url).toBe("https://www.ebay.com/itm/P999");
  });
});
