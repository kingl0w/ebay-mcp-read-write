import { z } from "zod";
import { ebayGet, ebayPut } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const reviseListingSchema = z.object({
  sku: z
    .string()
    .describe("SKU of the listing to revise (e.g. TDY-1234567890)"),
  price: z.number().positive().optional().describe("New price in USD"),
  quantity: z.number().int().min(0).optional().describe("New quantity"),
  title: z.string().max(80).optional().describe("New title"),
  description: z.string().optional().describe("New description (HTML)"),
  condition_description: z
    .string()
    .optional()
    .describe("New condition description"),
});

export type ReviseListingInput = z.infer<typeof reviseListingSchema>;

interface EbayOffer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  format: string;
  availableQuantity?: number;
  categoryId?: string;
  listingDescription?: string;
  listingPolicies?: Record<string, unknown>;
  merchantLocationKey?: string;
  pricingSummary?: {
    price?: { value?: string; currency?: string };
  };
  [key: string]: unknown;
}

interface EbayOfferLookup {
  offers: EbayOffer[];
}

interface EbayInventoryItem {
  availability?: {
    shipToLocationAvailability?: { quantity?: number };
  };
  condition?: string;
  conditionDescription?: string;
  product?: {
    title?: string;
    description?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
  };
}

export async function reviseListing(input: ReviseListingInput): Promise<{
  success: boolean;
  sku: string;
  changes: string[];
  message: string;
}> {
  const { sku } = input;
  const changes: string[] = [];

  const needsOfferUpdate =
    input.price !== undefined || input.quantity !== undefined;
  const needsItemUpdate =
    input.title !== undefined ||
    input.description !== undefined ||
    input.condition_description !== undefined;

  if (!needsOfferUpdate && !needsItemUpdate) {
    return {
      success: true,
      sku,
      changes: [],
      message: `\u270F\uFE0F Revised SKU ${sku}: no changes requested`,
    };
  }

  const tasks: Promise<void>[] = [];

  if (needsOfferUpdate) {
    tasks.push(
      (async () => {
        logger.info({ sku }, "Looking up offer for SKU");
        const lookup = await ebayGet<EbayOfferLookup>(
          `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`,
        );
        const offer = lookup.offers?.[0];
        if (!offer) {
          throw new Error(`No offer found for SKU ${sku}`);
        }

        const updatedOffer = { ...offer };
        if (input.price !== undefined) {
          updatedOffer.pricingSummary = {
            price: { value: input.price.toFixed(2), currency: "USD" },
          };
          changes.push(`price updated to $${input.price.toFixed(2)}`);
        }
        if (input.quantity !== undefined) {
          updatedOffer.availableQuantity = input.quantity;
          changes.push(`quantity updated to ${input.quantity}`);
        }

        logger.info({ sku, offerId: offer.offerId }, "Updating offer");
        await ebayPut(
          `/sell/inventory/v1/offer/${offer.offerId}`,
          updatedOffer,
        );
      })(),
    );
  }

  if (needsItemUpdate) {
    tasks.push(
      (async () => {
        logger.info({ sku }, "Fetching inventory item for update");
        const existing = await ebayGet<EbayInventoryItem>(
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        );

        const product = { ...existing.product };
        if (input.title !== undefined) {
          product.title = input.title;
          changes.push("title updated");
        }
        if (input.description !== undefined) {
          product.description = input.description;
          changes.push("description updated");
        }

        const updated: EbayInventoryItem = { ...existing, product };
        if (input.condition_description !== undefined) {
          updated.conditionDescription = input.condition_description;
          changes.push("condition description updated");
        }

        logger.info({ sku }, "Updating inventory item");
        await ebayPut(
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
          updated,
        );
      })(),
    );
  }

  await Promise.all(tasks);

  return {
    success: true,
    sku,
    changes,
    message: `\u270F\uFE0F Revised SKU ${sku}: ${changes.join(", ")}`,
  };
}
