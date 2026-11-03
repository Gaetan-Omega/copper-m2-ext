// Module 2: the tools Ask Copper can use (the course's four, plus our own
// compare_products). Products and prices come from lib/copper/catalog.ts and
// stock from lib/copper/inventory.ts, so the chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool } from "ai";
import { z } from "zod";
import { getPlans, getProducts } from "@/lib/copper/catalog";
import type { Plan, ProductId } from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

export type CompareProductsInput = { first: ProductId; second: ProductId };

export type Comparison =
  | {
      status: "ok";
      products: {
        id: ProductId;
        name: string;
        type: string;
        priceUsd: number;
        colors: string[];
        features: { name: string; description: string }[];
      }[];
      /** Always positive: how much more the pricier product costs. */
      priceDifferenceUsd: number;
      /** Name of the cheaper product, or null when they cost the same. */
      cheaper: string | null;
      /** Colors both products come in. */
      sharedColors: string[];
    }
  | { status: "cannot_compare"; message: string };

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      priceUsd: p.priceUsd,
      colors: p.colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
    })),
    plans: getPlans().map((p) => ({
      id: p.id,
      name: p.name,
      monthlyUsd: p.monthlyUsd,
      annualUsd: p.annualUsd,
    })),
  };
}

const productIds = ["copper-home", "copper-notes"] as const;

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(z.enum(productIds)).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

const toCents = (usd: number) => Math.round(usd * 100) / 100;

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = [];
  for (const id of input.products) {
    const product = catalog.find((p) => p.id === id);
    if (product)
      lines.push({ item: product.name, usd: toCents(product.priceUsd) });
  }
  // Copper Plus covers the whole household, so it is counted once.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (plan && plan.id !== "free") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const cadence = input.billing === "monthly" ? "monthly" : "yearly";
    const span = input.years === 1 ? "year" : "years";
    lines.push({
      item: `${plan.name} (${cadence}, ${input.years} ${span})`,
      usd: toCents(usd),
    });
  }
  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z.enum(productIds),
    color: z.string().optional(),
  });

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) {
    return {
      status: "unavailable",
      message: "That product isn't in the catalog.",
    };
  }

  // A color the product doesn't come in is checked first, before stock.
  let wanted: string | undefined;
  if (input.color !== undefined) {
    const asked = input.color.trim().toLowerCase();
    wanted = product.colors.find((c) => c.toLowerCase() === asked);
    if (!wanted) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  // Read stock fresh every time: it changes.
  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now.",
    };
  }

  const colors: { color: string; stock: Stock; restockDate: string | null }[] =
    [];
  for (const color of product.colors) {
    if (wanted && color !== wanted) continue;
    const row = rows.find(
      (r) => r.product === product.name && r.color === color,
    );
    if (!row) continue;
    const units = row.units_in_stock;
    const stock: Stock =
      units <= 0 ? "backordered" : units < 10 ? "low_stock" : "in_stock";
    colors.push({
      color,
      stock,
      restockDate: stock === "backordered" ? row.next_shipment : null,
    });
  }
  return { status: "ok", product: product.name, colors };
}

export const compareProductsInput: z.ZodType<CompareProductsInput> = z.object({
  first: z.enum(productIds),
  second: z.enum(productIds),
});

/** compare_products: two products side by side, read from the catalog. */
export function compareProducts(input: CompareProductsInput): Comparison {
  if (input.first === input.second) {
    return {
      status: "cannot_compare",
      message: "Pick two different products to compare.",
    };
  }
  const catalog = getProducts();
  const products = [input.first, input.second].flatMap((id) => {
    const p = catalog.find((product) => product.id === id);
    return p
      ? [
          {
            id: p.id,
            name: p.name,
            type: p.type,
            priceUsd: p.priceUsd,
            colors: p.colors,
            features: p.features,
          },
        ]
      : [];
  });
  if (products.length < 2) {
    return {
      status: "cannot_compare",
      message: "That product isn't in the catalog.",
    };
  }
  const [a, b] = products;
  return {
    status: "ok",
    products,
    priceDifferenceUsd: toCents(Math.abs(a.priceUsd - b.priceUsd)),
    cheaper:
      a.priceUsd === b.priceUsd
        ? null
        : a.priceUsd < b.priceUsd
          ? a.name
          : b.name,
    sharedColors: a.colors.filter((color) => b.colors.includes(color)),
  };
}

export const copperTools = {
  get_products: tool({
    description:
      "List every Copper product with its type, price and the colors it comes in. Says nothing about stock.",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Get the current price of every Copper product and the monthly and yearly price of every plan.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Work out the total cost of devices plus a plan over 1 to 5 years, with a line for each item.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Check today's stock for a product, or for one color of it, from the stock list.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
  compare_products: tool({
    description:
      "Compare two different Copper products side by side: type, price, price difference, colors, shared colors and features.",
    inputSchema: compareProductsInput,
    execute: async (input) => compareProducts(input),
  }),
};
