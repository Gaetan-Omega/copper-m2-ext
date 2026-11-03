// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getProducts } from "@/lib/copper/catalog";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import {
  compareProducts,
  compareProductsInput,
  copperTools,
} from "@/lib/copper/assistant/tools";

describe("compare_products", () => {
  it("puts both products side by side, with their facts from the catalog", () => {
    const result = compareProducts({ first: "copper-home", second: "copper-notes" });
    if (result.status !== "ok") throw new Error("expected a comparison");

    const catalog = getProducts();
    expect(result.products.map((p) => p.name)).toEqual([
      "Copper Home",
      "Copper Notes",
    ]);
    expect(result.products.map((p) => p.priceUsd)).toEqual(
      catalog.map((p) => p.priceUsd),
    );
    expect(result.products[0].features.map((f) => f.name)).toEqual(
      catalog[0].features.map((f) => f.name),
    );
    expect(result.products[1].colors).toEqual(catalog[1].colors);
  });

  it("says which one is cheaper and by how much", () => {
    const [home, notes] = getProducts();
    const result = compareProducts({ first: "copper-home", second: "copper-notes" });
    if (result.status !== "ok") throw new Error("expected a comparison");

    expect(result.priceDifferenceUsd).toBeCloseTo(
      Math.abs(home.priceUsd - notes.priceUsd),
    );
    expect(result.cheaper).toBe(
      home.priceUsd < notes.priceUsd ? home.name : notes.name,
    );
  });

  it("gives the same answer whichever product is named first", () => {
    const forward = compareProducts({ first: "copper-home", second: "copper-notes" });
    const backward = compareProducts({ first: "copper-notes", second: "copper-home" });
    if (forward.status !== "ok" || backward.status !== "ok") {
      throw new Error("expected comparisons");
    }
    expect(backward.priceDifferenceUsd).toBe(forward.priceDifferenceUsd);
    expect(backward.cheaper).toBe(forward.cheaper);
    expect(backward.sharedColors).toEqual(forward.sharedColors);
    expect(backward.products.map((p) => p.id)).toEqual(["copper-notes", "copper-home"]);
  });

  it("lists the colors both products come in", () => {
    const result = compareProducts({ first: "copper-home", second: "copper-notes" });
    if (result.status !== "ok") throw new Error("expected a comparison");
    expect(result.sharedColors).toEqual(["Night Sky"]);
  });

  it("refuses to compare a product with itself", () => {
    const result = compareProducts({ first: "copper-home", second: "copper-home" });
    expect(result.status).toBe("cannot_compare");
  });

  it("rejects products that aren't in the catalog", () => {
    expect(
      compareProductsInput.safeParse({ first: "copper-home", second: "copper-tv" })
        .success,
    ).toBe(false);
    expect(compareProductsInput.safeParse({ first: "copper-home" }).success).toBe(
      false,
    );
  });

  it("is one of Copper's tools, described for the model, and runs through the tool", async () => {
    const tool = copperTools.compare_products;
    expect(tool.description).toMatch(/compare/i);

    const viaTool = await tool.execute?.(
      { first: "copper-home", second: "copper-notes" },
      { toolCallId: "test", messages: [], context: {} },
    );
    expect(viaTool).toEqual(
      compareProducts({ first: "copper-home", second: "copper-notes" }),
    );
  });

  it("is mentioned in Copper's instructions so the model knows when to use it", () => {
    expect(COPPER_INSTRUCTIONS).toContain("compare_products");
  });
});
