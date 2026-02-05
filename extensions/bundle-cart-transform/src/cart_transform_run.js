// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const operations = [];

  for (const line of input.cart.lines) {
    const rawComponents = line.bundleComponents?.value;
    if (!rawComponents) continue;

    let components;
    try {
      components = JSON.parse(rawComponents);
    } catch {
      continue;
    }

    if (!Array.isArray(components) || components.length === 0) {
      continue;
    }

    const bundleId = line.bundleId?.value || "";
    const bundleVersion = line.bundleVersion?.value || "v1";
    const lineQuantity = line.quantity || 1;

    const tierRules = [
      { minFull: 2, minSmall: 4, percent: 20 },
      { minFull: 1, minSmall: 4, percent: 15 },
      { minFull: 1, minSmall: 2, percent: 10 },
    ];
    const fullCount = components
      .filter((component) => component?.role === "full")
      .reduce((sum, component) => sum + (Number(component?.quantity) || 1), 0);
    const smallCount = components
      .filter((component) => component?.role === "small")
      .reduce((sum, component) => sum + (Number(component?.quantity) || 1), 0);
    const tier = tierRules.find(
      (rule) => fullCount >= rule.minFull && smallCount >= rule.minSmall,
    );
    const percent = tier ? tier.percent : 0;

    const expandedCartItems = components
      .map((component) => {
        const id = component?.id;
        const quantity = Number(component?.quantity) || 1;
        const role = component?.role || "component";
        const price = component?.price;
        if (!id) return null;

        const merchandiseId = String(id).startsWith("gid://")
          ? String(id)
          : `gid://shopify/ProductVariant/${id}`;

        const item = {
          merchandiseId,
          quantity: quantity * lineQuantity,
          attributes: [
            { key: "_bundle_id", value: bundleId },
            { key: "_bundle_role", value: role },
            { key: "_bundle_version", value: bundleVersion },
          ],
        };

        if (price != null && price !== "" && percent > 0) {
          item.price = {
            adjustment: {
              fixedPricePerUnit: {
                amount: String(Number(price) * (1 - percent / 100)),
              },
            },
          };
        }

        return item;
      })
      .filter(Boolean);

    if (expandedCartItems.length === 0) {
      continue;
    }

    operations.push({
      lineExpand: {
        cartLineId: line.id,
        expandedCartItems,
      },
    });
  }

  return { operations };
}
