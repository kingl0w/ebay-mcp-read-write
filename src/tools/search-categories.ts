import { z } from "zod";
import { ebayGet } from "../ebay/client.js";
import { logger } from "../utils/logger.js";

export const searchCategoriesSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search term to find matching eBay categories (e.g. 'iPhone', 'Nike shoes', 'vintage watch')",
    ),
});

export type SearchCategoriesInput = z.infer<typeof searchCategoriesSchema>;

interface CategorySuggestion {
  category: {
    categoryId: string;
    categoryName: string;
  };
  categoryTreeNodeAncestors?: Array<{
    categoryId: string;
    categoryName: string;
  }>;
  categoryTreeNodeLevel: number;
}

interface CategorySuggestionsResponse {
  categorySuggestions?: CategorySuggestion[];
}

export async function searchCategories(input: SearchCategoriesInput) {
  const categoryTreeId = "0"; // EBAY_US
  const q = encodeURIComponent(input.query);

  logger.info({ query: input.query }, "Searching eBay categories");

  const response = await ebayGet<CategorySuggestionsResponse>(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_category_suggestions?q=${q}`,
  );

  const suggestions = (response.categorySuggestions ?? []).map((s) => {
    const ancestors = (s.categoryTreeNodeAncestors ?? [])
      .reverse()
      .map((a) => a.categoryName);
    const path = [...ancestors, s.category.categoryName].join(" > ");

    return {
      category_id: s.category.categoryId,
      name: s.category.categoryName,
      path,
    };
  });

  logger.info(
    { query: input.query, count: suggestions.length },
    "Category search complete",
  );

  return {
    query: input.query,
    count: suggestions.length,
    categories: suggestions,
  };
}
