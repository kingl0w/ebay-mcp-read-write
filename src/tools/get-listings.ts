import { z } from "zod";
import { ebayGet } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const getListingsSchema = z.object({
  status: z
    .enum(["ACTIVE", "INACTIVE", "ALL"])
    .default("ACTIVE")
    .describe("Filter by listing status"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Number of listings to return"),
  offset: z.number().int().min(0).default(0).describe("Pagination offset"),
});

export type GetListingsInput = z.infer<typeof getListingsSchema>;

interface EbayOffer {
  offerId: string;
  sku: string;
  status: string;
  listing?: { listingId?: string };
  pricingSummary?: {
    price?: { value?: string; currency?: string };
  };
  availableQuantity?: number;
}

interface EbayOffersResponse {
  offers: EbayOffer[];
  total: number;
  size: number;
  limit: number;
  offset: number;
}

function getListingUrl(listingId: string | null): string | null {
  if (!listingId) return null;
  const env = process.env.EBAY_ENV ?? "sandbox";
  return env === "sandbox"
    ? `https://www.sandbox.ebay.com/itm/${listingId}`
    : `https://www.ebay.com/itm/${listingId}`;
}

export async function getListings(input: GetListingsInput): Promise<{
  total: number;
  returned: number;
  offset: number;
  listings: Array<{
    sku: string;
    offer_id: string;
    listing_id: string | null;
    title: string;
    price: string;
    quantity: number;
    status: string;
    url: string | null;
  }>;
}> {
  logger.info(
    { status: input.status, limit: input.limit, offset: input.offset },
    "Fetching listings",
  );

  const response = await ebayGet<EbayOffersResponse>(
    `/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=${input.limit}&offset=${input.offset}`,
  );

  let offers = response.offers ?? [];

  if (input.status !== "ALL") {
    offers = offers.filter((o) => o.status === input.status);
  }

  const listings = await Promise.all(
    offers.map(async (offer) => {
      const listingId = offer.listing?.listingId ?? null;
      let title = offer.sku;
      try {
        const item = await ebayGet<{
          product?: { title?: string };
        }>(
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`,
        );
        title = item.product?.title ?? offer.sku;
      } catch {
        logger.warn({ sku: offer.sku }, "Could not fetch inventory item title");
      }
      return {
        sku: offer.sku,
        offer_id: offer.offerId,
        listing_id: listingId,
        title,
        price: offer.pricingSummary?.price?.value ?? "0.00",
        quantity: offer.availableQuantity ?? 0,
        status: offer.status,
        url: getListingUrl(listingId),
      };
    }),
  );

  return {
    total: response.total,
    returned: listings.length,
    offset: response.offset,
    listings,
  };
}
