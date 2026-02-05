import { DiscountClass, ProductDiscountSelectionStrategy } from "../generated/api";

const BUNDLE_VERSION = "v1";
const ROLE_FULL = "full";
const ROLE_SMALL = "small";

const tierRules = [
  { minFull: 2, minSmall: 4, percent: 20 },
  { minFull: 1, minSmall: 4, percent: 15 },
  { minFull: 1, minSmall: 2, percent: 10 },
];


/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    return {operations: []};
  }

  const hasBundleLines = input.cart.lines.some(
    (line) => line.bundleId?.value,
  );
  if (hasBundleLines) {
    return {operations: []};
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  const bundles = new Map();

  for (const line of input.cart.lines) {
    const bundleId = line.bundleId?.value;
    const bundleRole = line.bundleRole?.value;
    const bundleVersion = line.bundleVersion?.value;

    if (!bundleId || !bundleRole || bundleVersion !== BUNDLE_VERSION) {
      continue;
    }

    if (bundleRole !== ROLE_FULL && bundleRole !== ROLE_SMALL) {
      continue;
    }

    const current = bundles.get(bundleId) || {
      fullCount: 0,
      smallCount: 0,
      lineIds: [],
    };

    const quantity = line.quantity || 0;
    if (bundleRole === ROLE_FULL) {
      current.fullCount += quantity;
    } else {
      current.smallCount += quantity;
    }
    current.lineIds.push(line.id);

    bundles.set(bundleId, current);
  }

  if (!bundles.size) {
    return {operations: []};
  }

  const candidates = [];

  for (const bundle of bundles.values()) {
    const rule = tierRules.find(
      (tier) => bundle.fullCount >= tier.minFull && bundle.smallCount >= tier.minSmall,
    );
    if (!rule) {
      continue;
    }

    const targets = bundle.lineIds.map((id) => ({
      cartLine: { id },
    }));

    candidates.push({
      message: `Bundle ${rule.percent}% off`,
      targets,
      value: {
        percentage: {
          value: rule.percent,
        },
      },
    });
  }

  if (!candidates.length) {
    return {operations: []};
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}
