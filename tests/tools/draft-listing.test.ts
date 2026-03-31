import { describe, expect, it } from "vitest";
import {
  draftListing,
  draftListingSchema,
} from "../../src/tools/draft-listing.js";

const VALID_INPUT = {
  title: "Apple iPhone 14 Pro Max 256GB Space Black Unlocked",
  description:
    "Apple iPhone 14 Pro Max in Space Black.\n\n256GB storage, factory unlocked.\n\nMint condition with no scratches.",
  price: 899,
  shipping_cost: 0,
  condition: "LIKE_NEW" as const,
  condition_description:
    "Device is in excellent condition with no visible scratches or dents.",
  category_id: "9355",
  item_specifics: { Brand: "Apple", Model: "iPhone 14 Pro Max" },
  quantity: 1,
};

describe("draftListingSchema", () => {
  it("should validate a complete input", () => {
    const result = draftListingSchema.parse(VALID_INPUT);
    expect(result.title).toBe(VALID_INPUT.title);
    expect(result.price).toBe(899);
    expect(result.condition).toBe("LIKE_NEW");
  });

  it("should apply defaults for shipping_cost and quantity", () => {
    const { shipping_cost, quantity, ...rest } = VALID_INPUT;
    const result = draftListingSchema.parse(rest);
    expect(result.shipping_cost).toBe(0);
    expect(result.quantity).toBe(1);
  });

  it("should reject title longer than 80 chars", () => {
    expect(() =>
      draftListingSchema.parse({ ...VALID_INPUT, title: "A".repeat(81) }),
    ).toThrow();
  });

  it("should require title", () => {
    const { title, ...rest } = VALID_INPUT;
    expect(() => draftListingSchema.parse(rest)).toThrow();
  });

  it("should require price", () => {
    const { price, ...rest } = VALID_INPUT;
    expect(() => draftListingSchema.parse(rest)).toThrow();
  });

  it("should require condition", () => {
    const { condition, ...rest } = VALID_INPUT;
    expect(() => draftListingSchema.parse(rest)).toThrow();
  });

  it("should require category_id", () => {
    const { category_id, ...rest } = VALID_INPUT;
    expect(() => draftListingSchema.parse(rest)).toThrow();
  });

  it("should require description", () => {
    const { description, ...rest } = VALID_INPUT;
    expect(() => draftListingSchema.parse(rest)).toThrow();
  });

  it("should reject negative price", () => {
    expect(() =>
      draftListingSchema.parse({ ...VALID_INPUT, price: -10 }),
    ).toThrow();
  });

  it("should reject invalid condition", () => {
    expect(() =>
      draftListingSchema.parse({ ...VALID_INPUT, condition: "BROKEN" }),
    ).toThrow();
  });
});

describe("draftListing", () => {
  it("should return summary and draft with correct structure", () => {
    const result = draftListing(VALID_INPUT);

    expect(result.summary).toBe(
      "\u{1F4E6} Draft ready: Apple iPhone 14 Pro Max 256GB Space Black Unlocked \u2014 $899 (LIKE_NEW)",
    );
    expect(result.draft.title).toBe(VALID_INPUT.title);
    expect(result.draft.category_id).toBe("9355");
    expect(result.draft.condition).toBe("LIKE_NEW");
    expect(result.draft.condition_description).toBe(
      VALID_INPUT.condition_description,
    );
    expect(result.draft.item_specifics).toEqual(VALID_INPUT.item_specifics);
    expect(result.draft.price).toBe(899);
    expect(result.draft.shipping_cost).toBe(0);
    expect(result.draft.quantity).toBe(1);
    expect(result.draft.images).toEqual([]);
    expect(result.draft.draft).toBe(true);
  });

  it("should format description as HTML paragraphs", () => {
    const result = draftListing(VALID_INPUT);

    expect(result.draft.description).toBe(
      "<p>Apple iPhone 14 Pro Max in Space Black.</p>" +
        "<p>256GB storage, factory unlocked.</p>" +
        "<p>Mint condition with no scratches.</p>",
    );
  });

  it("should handle single-paragraph descriptions", () => {
    const result = draftListing({
      ...VALID_INPUT,
      description: "Simple one-liner description",
    });
    expect(result.draft.description).toBe(
      "<p>Simple one-liner description</p>",
    );
  });
});

describe("condition mapping", () => {
  const conditions = [
    "NEW",
    "LIKE_NEW",
    "EXCELLENT",
    "GOOD",
    "ACCEPTABLE",
  ] as const;

  for (const condition of conditions) {
    it(`should preserve condition ${condition} in draft`, () => {
      const result = draftListing({ ...VALID_INPUT, condition });
      expect(result.draft.condition).toBe(condition);
    });
  }
});
