import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ebayDelete, ebayPost, ebayPut } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const createListingSchema = z.object({
  draft: z
    .object({
      title: z.string(),
      category_id: z.string(),
      condition: z.string(),
      condition_description: z.string(),
      description: z.string(),
      item_specifics: z.record(z.string()),
      price: z.number(),
      shipping_cost: z.number(),
      quantity: z.number().default(1),
      images: z.array(z.string()).optional(),
      weight_lb: z.number().default(0.5),
      dimensions: z
        .object({
          length: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .optional(),
    })
    .describe("Draft object from draft_listing tool"),
  fulfillment_policy_id: z
    .string()
    .optional()
    .describe(
      "eBay fulfillment policy ID — if omitted uses EBAY_FULFILLMENT_POLICY_ID env var",
    ),
  payment_policy_id: z
    .string()
    .optional()
    .describe(
      "eBay payment policy ID — if omitted uses EBAY_PAYMENT_POLICY_ID env var",
    ),
  return_policy_id: z
    .string()
    .optional()
    .describe(
      "eBay return policy ID — if omitted uses EBAY_RETURN_POLICY_ID env var",
    ),
  merchant_location_key: z
    .string()
    .optional()
    .describe(
      "eBay merchant location key — if omitted uses EBAY_MERCHANT_LOCATION_KEY env var",
    ),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;

function getListingUrl(listingId: string): string {
  const env = process.env.EBAY_ENV ?? "sandbox";
  return env === "sandbox"
    ? `https://www.sandbox.ebay.com/itm/${listingId}`
    : `https://www.ebay.com/itm/${listingId}`;
}

function resolvePolicies(input: CreateListingInput): {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
} {
  const fulfillmentPolicyId =
    input.fulfillment_policy_id ?? process.env.EBAY_FULFILLMENT_POLICY_ID;
  const paymentPolicyId =
    input.payment_policy_id ?? process.env.EBAY_PAYMENT_POLICY_ID;
  const returnPolicyId =
    input.return_policy_id ?? process.env.EBAY_RETURN_POLICY_ID;
  const merchantLocationKey =
    input.merchant_location_key ?? process.env.EBAY_MERCHANT_LOCATION_KEY;

  const missing: string[] = [];
  if (!fulfillmentPolicyId)
    missing.push("fulfillment_policy_id / EBAY_FULFILLMENT_POLICY_ID");
  if (!paymentPolicyId)
    missing.push("payment_policy_id / EBAY_PAYMENT_POLICY_ID");
  if (!returnPolicyId) missing.push("return_policy_id / EBAY_RETURN_POLICY_ID");
  if (!merchantLocationKey)
    missing.push("merchant_location_key / EBAY_MERCHANT_LOCATION_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required policy IDs: ${missing.join(", ")}. ` +
        "Set them in .env or pass them as tool inputs. " +
        "Find your policy IDs in Seller Hub → Account → Business Policies.",
    );
  }

  return {
    fulfillmentPolicyId: fulfillmentPolicyId as string,
    paymentPolicyId: paymentPolicyId as string,
    returnPolicyId: returnPolicyId as string,
    merchantLocationKey: merchantLocationKey as string,
  };
}

function extractEbayError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as { response?: { data?: unknown } }).response?.data
  ) {
    const data = (error as { response: { data: unknown } }).response.data;
    if (typeof data === "object" && data && "errors" in data) {
      const errors = (data as { errors: Array<{ message?: string }> }).errors;
      return errors.map((e) => e.message).join("; ");
    }
    return JSON.stringify(data);
  }
  return error instanceof Error ? error.message : String(error);
}

const CONDITION_MAP: Record<string, string> = {
  NEW: "NEW",
  LIKE_NEW: "LIKE_NEW",
  NEW_OTHER: "NEW_OTHER",
  NEW_WITH_DEFECTS: "NEW_WITH_DEFECTS",
  SELLER_REFURBISHED: "SELLER_REFURBISHED",
  EXCELLENT: "USED_EXCELLENT",
  VERY_GOOD: "USED_VERY_GOOD",
  GOOD: "USED_GOOD",
  ACCEPTABLE: "USED_ACCEPTABLE",
  FOR_PARTS: "FOR_PARTS_OR_NOT_WORKING",
};

export function generateSku(): string {
  return `TDY-${randomUUID().slice(0, 12)}`;
}

export async function createListing(input: CreateListingInput): Promise<{
  success: boolean;
  sku: string;
  offer_id: string;
  listing_id: string;
  url: string;
  message: string;
}> {
  const { draft } = input;
  const policies = resolvePolicies(input);
  const sku = generateSku();

  logger.info({ sku }, "Step 1/3: Creating inventory item");
  try {
    await ebayPut(`/sell/inventory/v1/inventory_item/${sku}`, {
      availability: {
        shipToLocationAvailability: { quantity: draft.quantity },
      },
      packageWeightAndSize: {
        dimensions: {
          height: draft.dimensions?.height ?? 1,
          length: draft.dimensions?.length ?? 8,
          width: draft.dimensions?.width ?? 6,
          unit: "INCH",
        },
        packageType: "PACKAGE_THICK_ENVELOPE",
        weight: {
          value: draft.weight_lb,
          unit: "POUND",
        },
      },
      condition: CONDITION_MAP[draft.condition] ?? draft.condition,
      conditionDescription: draft.condition_description,
      product: {
        title: draft.title,
        description: draft.description,
        aspects: Object.fromEntries(
          Object.entries(draft.item_specifics).map(([k, v]) => [k, [v]]),
        ),
        ...(draft.images?.length ? { imageUrls: draft.images } : {}),
      },
    });
  } catch (error) {
    throw new Error(
      `Failed to create inventory item: ${extractEbayError(error)}`,
    );
  }

  logger.info({ sku }, "Step 2/3: Creating offer");
  let offerId: string;
  try {
    const offerResponse = await ebayPost<{ offerId: string }>(
      "/sell/inventory/v1/offer",
      {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: draft.quantity,
        categoryId: draft.category_id,
        listingDescription: draft.description,
        listingPolicies: {
          fulfillmentPolicyId: policies.fulfillmentPolicyId,
          paymentPolicyId: policies.paymentPolicyId,
          returnPolicyId: policies.returnPolicyId,
        },
        merchantLocationKey: policies.merchantLocationKey,
        pricingSummary: {
          price: {
            value: draft.price.toFixed(2),
            currency: "USD",
          },
        },
      },
    );
    offerId = offerResponse.offerId;
  } catch (error) {
    try {
      logger.warn({ sku }, "Offer creation failed — deleting orphaned inventory item");
      await ebayDelete(`/sell/inventory/v1/inventory_item/${sku}`);
    } catch (cleanupError) {
      logger.error({ sku, cleanupError }, "Failed to clean up inventory item");
    }
    throw new Error(`Failed to create offer: ${extractEbayError(error)}`);
  }

  logger.info({ sku, offerId }, "Step 3/3: Publishing offer");
  let listingId: string;
  try {
    const publishResponse = await ebayPost<{ listingId: string }>(
      `/sell/inventory/v1/offer/${offerId}/publish`,
      {},
    );
    listingId = publishResponse.listingId;
  } catch (error) {
    try {
      logger.warn({ sku, offerId }, "Publish failed — cleaning up offer and inventory item");
      await ebayDelete(`/sell/inventory/v1/offer/${offerId}`);
      await ebayDelete(`/sell/inventory/v1/inventory_item/${sku}`);
    } catch (cleanupError) {
      logger.error({ sku, offerId, cleanupError }, "Failed to clean up after publish failure");
    }
    throw new Error(`Failed to publish offer: ${extractEbayError(error)}`);
  }

  const url = getListingUrl(listingId);
  logger.info({ sku, offerId, listingId, url }, "Listing published");

  return {
    success: true,
    sku,
    offer_id: offerId,
    listing_id: listingId,
    url,
    message: `\u2705 Listed: ${draft.title} \u2014 ${draft.price} (SKU: ${sku})`,
  };
}
