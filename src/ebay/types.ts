export type EbayEnvironment = "sandbox" | "production";

export interface EbayAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expiry_timestamp: number;
}

export interface EbayError {
  errorId: number;
  domain: string;
  category: string;
  message: string;
  longMessage?: string;
}

export interface EbayErrorResponse {
  errors: EbayError[];
}

export interface InventoryItem {
  sku: string;
  locale?: string;
  product: {
    title: string;
    description: string;
    aspects?: Record<string, string[]>;
    imageUrls: string[];
  };
  condition: string;
  conditionDescription?: string;
  availability: {
    shipToLocationAvailability: {
      quantity: number;
    };
  };
}

export interface Offer {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  listingDescription?: string;
  availableQuantity: number;
  pricingSummary: {
    price: {
      value: string;
      currency: string;
    };
  };
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
  categoryId: string;
  merchantLocationKey?: string;
}

export interface ListingDraft {
  title: string;
  description: string;
  category: string;
  condition: string;
  price: {
    value: string;
    currency: string;
  };
  images: string[];
  aspects?: Record<string, string[]>;
}

export interface ActiveListing {
  listingId: string;
  sku: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  quantity: number;
  status: string;
}
