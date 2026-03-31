import { z } from "zod";

export const draftListingSchema = z.object({
  title: z
    .string()
    .max(80)
    .describe("eBay listing title (max 80 chars, keyword-rich)"),
  description: z
    .string()
    .describe(
      "Product description — what it is, specs, condition, compatibility",
    ),
  price: z.number().positive().describe("Listing price in USD"),
  shipping_cost: z
    .number()
    .min(0)
    .default(0)
    .describe("Shipping cost in USD, 0 for free shipping"),
  condition: z
    .enum(["NEW", "LIKE_NEW", "EXCELLENT", "GOOD", "ACCEPTABLE"])
    .describe("Item condition"),
  condition_description: z
    .string()
    .describe("1-2 sentences describing observed condition"),
  category_id: z.string().describe("eBay category ID"),
  item_specifics: z
    .record(z.string())
    .describe(
      "Key-value pairs of item specifics e.g. Brand, Model, Storage Capacity",
    ),
  quantity: z.number().int().min(1).default(1),
});

export type DraftListingInput = z.infer<typeof draftListingSchema>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDescriptionHtml(description: string): string {
  return description
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

export function draftListing(input: DraftListingInput): {
  summary: string;
  draft: Record<string, unknown>;
} {
  const htmlDescription = formatDescriptionHtml(input.description);

  const draft = {
    title: input.title,
    category_id: input.category_id,
    condition: input.condition,
    condition_description: input.condition_description,
    description: htmlDescription,
    item_specifics: input.item_specifics,
    price: input.price,
    shipping_cost: input.shipping_cost,
    quantity: input.quantity,
    images: [],
    draft: true,
  };

  return {
    summary: `\u{1F4E6} Draft ready: ${input.title} \u2014 $${input.price} (${input.condition})`,
    draft,
  };
}
