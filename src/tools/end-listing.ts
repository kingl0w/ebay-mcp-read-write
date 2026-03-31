import { z } from "zod";
import { ebayDelete, ebayGet, ebayPost } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const endListingSchema = z.object({
  sku: z.string().describe("SKU of the listing to end"),
  reason: z
    .enum(["NOT_AVAILABLE", "INCORRECT_ITEM_INFO", "LOST_OR_BROKEN", "OTHER"])
    .default("NOT_AVAILABLE")
    .describe("Reason for ending the listing"),
});

export type EndListingInput = z.infer<typeof endListingSchema>;

interface EbayOfferLookup {
  offers: Array<{
    offerId: string;
    status: string;
  }>;
}

export async function endListing(input: EndListingInput): Promise<{
  success: boolean;
  sku: string;
  offer_id: string;
  message: string;
}> {
  const { sku } = input;

  logger.info({ sku }, "Looking up offer for SKU");
  const lookup = await ebayGet<EbayOfferLookup>(
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`,
  );
  const offer = lookup.offers?.[0];
  if (!offer) {
    throw new Error(`No offer found for SKU ${sku}`);
  }

  if (offer.status !== "ACTIVE" && offer.status !== "PUBLISHED") {
    logger.info({ sku, status: offer.status }, "Offer already inactive");
    return {
      success: true,
      sku,
      offer_id: offer.offerId,
      message: `SKU ${sku} is already inactive (status: ${offer.status})`,
    };
  }

  logger.info({ sku, offerId: offer.offerId }, "Withdrawing offer");
  await ebayPost(`/sell/inventory/v1/offer/${offer.offerId}/withdraw`, {});

  logger.info({ sku }, "Deleting inventory item");
  await ebayDelete(
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
  );

  return {
    success: true,
    sku,
    offer_id: offer.offerId,
    message: `\u{1F5D1}\uFE0F Ended listing for SKU ${sku}`,
  };
}
