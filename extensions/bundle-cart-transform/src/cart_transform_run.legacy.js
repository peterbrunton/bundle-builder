// @ts-check
// Legacy implementation snapshot kept for quick rollback.

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
const parseComponents = (rawComponents) => {
  if (!rawComponents) return null;
  let components;
  try {
    components = JSON.parse(rawComponents);
  } catch {
    return null;
  }
  if (!Array.isArray(components) || components.length === 0) {
    return null;
  }
  return components;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeComponents = (components) =>
  components
    .map((component) => {
      const id = component?.id;
      if (!id) return null;
      return {
        id: String(id),
        quantity: Math.max(1, Math.floor(toNumber(component?.quantity, 1))),
        role: component?.role || "component",
      };
    })
    .filter(Boolean);

const hasSignature = (value) => String(value || "").length > 0;

export function cartTransformRun(input) {
  const operations = [];

  for (const line of input.cart.lines) {
    const components = normalizeComponents(
      parseComponents(line.bundleComponents?.value),
    );
    if (!components || components.length === 0) continue;

    const bundleId = line.bundleId?.value || "";
    const bundleVersion = line.bundleVersion?.value || "v1";
    const lineQuantity = line.quantity || 1;
    const discountedCents = Math.max(
      0,
      Math.floor(toNumber(line.bundleDiscountedCents?.value, 0)),
    );
    const compareAtCents = Math.max(
      0,
      Math.floor(toNumber(line.bundleCompareAtCents?.value, 0)),
    );
    const signature = line.bundleSignature?.value || "";
    const signatureValid = hasSignature(signature);

    const totalComponentQty = components.reduce(
      (sum, component) => sum + (Number(component?.quantity) || 1),
      0,
    );
    const fallbackUnitAmount =
      signatureValid && discountedCents > 0 && totalComponentQty > 0
        ? (discountedCents / 100) / totalComponentQty
        : null;

    const expandedCartItems = components
      .map((component) => {
        const id = component?.id;
        const quantity = Number(component?.quantity) || 1;
        const role = component?.role || "component";
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

        if (fallbackUnitAmount != null) {
          item.price = {
            adjustment: {
              fixedPricePerUnit: {
                amount: fallbackUnitAmount.toFixed(2),
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

    if (discountedCents > 0 && signatureValid) {
      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          price: {
            adjustment: {
              fixedPricePerUnit: {
                amount: (discountedCents / 100).toFixed(2),
              },
            },
          },
        },
      });
    }
  }

  return { operations };
}
