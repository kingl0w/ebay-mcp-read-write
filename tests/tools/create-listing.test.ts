import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CreateListingInput,
  createListing,
  generateSku,
} from "../../src/tools/create-listing.js";

vi.mock("../../src/ebay/client.js", () => ({
  ebayPut: vi.fn(),
  ebayPost: vi.fn(),
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

const VALID_DRAFT = {
  title: "Apple iPhone 14 Pro Max 256GB Space Black Unlocked",
  category_id: "9355",
  condition: "LIKE_NEW",
  condition_description: "Excellent condition, no scratches.",
  description: "<p>iPhone 14 Pro Max</p>",
  item_specifics: { Brand: "Apple", Model: "iPhone 14 Pro Max" },
  price: 899,
  shipping_cost: 0,
  quantity: 1,
  images: ["https://example.com/img1.jpg"],
};

function validInput(
  overrides?: Partial<CreateListingInput>,
): CreateListingInput {
  return {
    draft: VALID_DRAFT,
    fulfillment_policy_id: "fulfill-123",
    payment_policy_id: "pay-456",
    return_policy_id: "return-789",
    merchant_location_key: "loc-001",
    ...overrides,
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

describe("generateSku", () => {
  it("should match TDY-{timestamp} format", () => {
    const sku = generateSku();
    expect(sku).toMatch(/^TDY-[a-f0-9-]+$/);
  });
});

describe("createListing", () => {
  it("should complete 3-step flow and return correct shape", async () => {
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "offer-abc" })
      .mockResolvedValueOnce({ listingId: "listing-xyz" });

    const result = await createListing(validInput());

    expect(result.success).toBe(true);
    expect(result.sku).toMatch(/^TDY-[a-f0-9-]+$/);
    expect(result.offer_id).toBe("offer-abc");
    expect(result.listing_id).toBe("listing-xyz");
    expect(result.url).toContain("listing-xyz");
    expect(result.message).toContain("Listed:");
    expect(result.message).toContain(VALID_DRAFT.title);
  });

  it("should call ebayPut with correct inventory item payload", async () => {
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockResolvedValueOnce({ listingId: "l1" });

    await createListing(validInput());

    expect(ebayPut).toHaveBeenCalledWith(
      expect.stringMatching(/^\/sell\/inventory\/v1\/inventory_item\/TDY-[a-f0-9-]+$/),
      expect.objectContaining({
        condition: "LIKE_NEW",
        conditionDescription: "Excellent condition, no scratches.",
        product: expect.objectContaining({
          title: VALID_DRAFT.title,
          description: VALID_DRAFT.description,
          aspects: { Brand: ["Apple"], Model: ["iPhone 14 Pro Max"] },
          imageUrls: VALID_DRAFT.images,
        }),
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      }),
    );
  });

  it("should call ebayPost with correct offer payload", async () => {
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockResolvedValueOnce({ listingId: "l1" });

    await createListing(validInput());

    expect(ebayPost).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer",
      expect.objectContaining({
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        categoryId: "9355",
        pricingSummary: {
          price: { value: "899.00", currency: "USD" },
        },
        listingPolicies: {
          fulfillmentPolicyId: "fulfill-123",
          paymentPolicyId: "pay-456",
          returnPolicyId: "return-789",
        },
        merchantLocationKey: "loc-001",
      }),
    );
  });

  it("should return sandbox URL when EBAY_ENV=sandbox", async () => {
    process.env.EBAY_ENV = "sandbox";
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockResolvedValueOnce({ listingId: "12345" });

    const result = await createListing(validInput());
    expect(result.url).toBe("https://www.sandbox.ebay.com/itm/12345");
  });

  it("should return production URL when EBAY_ENV=production", async () => {
    process.env.EBAY_ENV = "production";
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockResolvedValueOnce({ listingId: "67890" });

    const result = await createListing(validInput());
    expect(result.url).toBe("https://www.ebay.com/itm/67890");
  });

  it("should resolve policy IDs from env vars when not in input", async () => {
    process.env.EBAY_FULFILLMENT_POLICY_ID = "env-fulfill";
    process.env.EBAY_PAYMENT_POLICY_ID = "env-pay";
    process.env.EBAY_RETURN_POLICY_ID = "env-return";
    process.env.EBAY_MERCHANT_LOCATION_KEY = "env-loc";

    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockResolvedValueOnce({ listingId: "l1" });

    await createListing({ draft: VALID_DRAFT });

    expect(ebayPost).toHaveBeenCalledWith(
      "/sell/inventory/v1/offer",
      expect.objectContaining({
        listingPolicies: {
          fulfillmentPolicyId: "env-fulfill",
          paymentPolicyId: "env-pay",
          returnPolicyId: "env-return",
        },
        merchantLocationKey: "env-loc",
      }),
    );
  });
});

describe("createListing error handling", () => {
  it("should throw when policy IDs are missing", async () => {
    delete process.env.EBAY_FULFILLMENT_POLICY_ID;
    delete process.env.EBAY_PAYMENT_POLICY_ID;
    delete process.env.EBAY_RETURN_POLICY_ID;
    delete process.env.EBAY_MERCHANT_LOCATION_KEY;

    await expect(createListing({ draft: VALID_DRAFT })).rejects.toThrow(
      "Missing required policy IDs",
    );
  });

  it("should list all missing policy IDs in error message", async () => {
    delete process.env.EBAY_FULFILLMENT_POLICY_ID;
    delete process.env.EBAY_PAYMENT_POLICY_ID;
    delete process.env.EBAY_RETURN_POLICY_ID;
    delete process.env.EBAY_MERCHANT_LOCATION_KEY;

    await expect(createListing({ draft: VALID_DRAFT })).rejects.toThrow(
      /fulfillment_policy_id.*payment_policy_id.*return_policy_id.*merchant_location_key/,
    );
  });

  it("should mention Seller Hub in missing policy error", async () => {
    await expect(createListing({ draft: VALID_DRAFT })).rejects.toThrow(
      "Seller Hub",
    );
  });

  it("should throw correct error when inventory item creation fails", async () => {
    const { ebayPut } = await import("../../src/ebay/client.js");

    const apiError = Object.assign(new Error("API error"), {
      response: {
        data: { errors: [{ message: "Invalid SKU format" }] },
      },
    });
    vi.mocked(ebayPut).mockRejectedValueOnce(apiError);

    await expect(createListing(validInput())).rejects.toThrow(
      "Failed to create inventory item: Invalid SKU format",
    );
  });

  it("should throw correct error when offer creation fails", async () => {
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    const apiError = Object.assign(new Error("API error"), {
      response: {
        data: { errors: [{ message: "Invalid category" }] },
      },
    });
    vi.mocked(ebayPost).mockRejectedValueOnce(apiError);

    await expect(createListing(validInput())).rejects.toThrow(
      "Failed to create offer: Invalid category",
    );
  });

  it("should throw correct error when publish fails", async () => {
    const { ebayPut, ebayPost } = await import("../../src/ebay/client.js");

    vi.mocked(ebayPut).mockResolvedValueOnce(undefined);
    vi.mocked(ebayPost)
      .mockResolvedValueOnce({ offerId: "o1" })
      .mockRejectedValueOnce(
        Object.assign(new Error("API error"), {
          response: {
            data: { errors: [{ message: "Offer not ready" }] },
          },
        }),
      );

    await expect(createListing(validInput())).rejects.toThrow(
      "Failed to publish offer: Offer not ready",
    );
  });
});
