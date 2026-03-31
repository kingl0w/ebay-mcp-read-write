import { z } from "zod";
import { ebayGet } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const getCategoryAspectsSchema = z.object({
  category_id: z
    .string()
    .describe(
      "eBay category ID to get item specifics for (use search_categories to find this)",
    ),
});

export type GetCategoryAspectsInput = z.infer<typeof getCategoryAspectsSchema>;

interface AspectValue {
  localizedValue: string;
}

interface AspectConstraint {
  aspectRequired?: boolean;
  aspectUsage?: string;
  aspectMode?: string;
  itemToAspectCardinality?: string;
  aspectApplicableTo?: string[];
}

interface Aspect {
  localizedAspectName: string;
  aspectConstraint?: AspectConstraint;
  aspectValues?: AspectValue[];
}

interface AspectResponse {
  categoryId: string;
  aspects?: Aspect[];
}

export async function getCategoryAspects(input: GetCategoryAspectsInput) {
  const categoryTreeId = "0"; // EBAY_US

  logger.info({ categoryId: input.category_id }, "Fetching category aspects");

  const response = await ebayGet<AspectResponse>(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category?category_id=${input.category_id}`,
  );

  const aspects = (response.aspects ?? []).map((a) => {
    const constraint = a.aspectConstraint;
    const usage = constraint?.aspectRequired
      ? "REQUIRED"
      : constraint?.aspectUsage === "RECOMMENDED"
        ? "RECOMMENDED"
        : "OPTIONAL";

    const values = (a.aspectValues ?? []).map((v) => v.localizedValue);

    return {
      name: a.localizedAspectName,
      usage,
      mode: constraint?.aspectMode ?? "FREE_TEXT",
      cardinality: constraint?.itemToAspectCardinality ?? "SINGLE",
      values: values.length > 0 ? values.slice(0, 50) : undefined,
    };
  });

  const required = aspects.filter((a) => a.usage === "REQUIRED");
  const recommended = aspects.filter((a) => a.usage === "RECOMMENDED");
  const optional = aspects.filter((a) => a.usage === "OPTIONAL");

  logger.info(
    {
      categoryId: input.category_id,
      required: required.length,
      recommended: recommended.length,
      optional: optional.length,
    },
    "Category aspects fetched",
  );

  return {
    category_id: input.category_id,
    total: aspects.length,
    summary: {
      required: required.length,
      recommended: recommended.length,
      optional: optional.length,
    },
    required,
    recommended,
    optional,
  };
}
