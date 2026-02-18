import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const DEFAULT_RULEBOOK = {
  id: "bundle-config-1",
  isDefault: true,
  categories: [
    { key: "full", label: "Full", min: 1, max: 2 },
    { key: "small", label: "Small", min: 2, max: 4 },
  ],
  tiers: [
    {
      percent: 20,
      requirements: {
        full: { min: 2, max: null },
        small: { min: 4, max: null },
      },
    },
    {
      percent: 15,
      requirements: {
        full: { min: 1, max: null },
        small: { min: 4, max: null },
      },
    },
    {
      percent: 10,
      requirements: {
        full: { min: 1, max: null },
        small: { min: 2, max: null },
      },
    },
  ],
};

const coerceCategories = (value) => {
  if (!Array.isArray(value)) return DEFAULT_RULEBOOK.categories;
  const sanitized = value
    .map((category) => ({
      key: String(category?.key || "").trim(),
      label: String(category?.label || "").trim(),
      min: Math.max(0, Number(category?.min ?? 0)),
      max:
        category?.max === null || category?.max === ""
          ? null
          : Math.max(0, Number(category?.max ?? 0)),
    }))
    .filter((category) => category.key && category.label);
  return sanitized.length ? sanitized : DEFAULT_RULEBOOK.categories;
};

const coerceTierRules = (value, categories) => {
  if (!Array.isArray(value)) return DEFAULT_RULEBOOK.tiers;
  const sanitized = value
    .map((rule) => ({
      percent: Math.min(100, Math.max(0, Number(rule?.percent ?? 0))),
      requirements: rule?.requirements || {},
    }))
    .map((rule) => ({
      ...rule,
      requirements: categories.reduce((acc, category) => {
        const req = rule.requirements?.[category.key] || {};
        acc[category.key] = {
          min: Math.max(0, Number(req?.min ?? 0)),
          max:
            req?.max === null || req?.max === ""
              ? null
              : Math.max(0, Number(req?.max ?? 0)),
        };
        return acc;
      }, {}),
    }))
    .filter((rule) => !Number.isNaN(rule.percent));
  return sanitized.length ? sanitized : DEFAULT_RULEBOOK.tiers;
};

const normalizeRulebooks = (rulebooks) => {
  if (!Array.isArray(rulebooks) || rulebooks.length === 0) {
    return [DEFAULT_RULEBOOK];
  }
  const usedIds = new Set();
  const nextUniqueId = (rawId, index) => {
    const base = String(rawId || "").trim() || `bundle-config-${index + 1}`;
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let counter = 2;
    let candidate = `${base}-${counter}`;
    while (usedIds.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const normalized = rulebooks
    .map((rulebook, index) => {
      const categories = coerceCategories(rulebook?.categories);
      const tiers = coerceTierRules(rulebook?.tiers, categories);
      return {
        id: nextUniqueId(rulebook?.id, index),
        isDefault: Boolean(rulebook?.isDefault),
        categories,
        tiers,
      };
    })
    .filter((rulebook) => rulebook.id);

  if (!normalized.length) return [DEFAULT_RULEBOOK];

  let hasDefault = normalized.some((rulebook) => rulebook.isDefault);
  if (!hasDefault) {
    normalized[0] = { ...normalized[0], isDefault: true };
  } else {
    let defaultSeen = false;
    for (let i = 0; i < normalized.length; i += 1) {
      if (normalized[i].isDefault) {
        if (defaultSeen) {
          normalized[i] = { ...normalized[i], isDefault: false };
        } else {
          defaultSeen = true;
        }
      }
    }
  }
  return normalized;
};

const deriveRulebooksFallback = (categories, tiers) => {
  return normalizeRulebooks([
    {
      id: "bundle-config-1",
      isDefault: true,
      categories,
      tiers,
    },
  ]);
};

const getNextRulebookId = (rulebooks) => {
  const used = new Set((rulebooks || []).map((rulebook) => String(rulebook?.id || "").trim()).filter(Boolean));
  let counter = 1;
  let candidate = `bundle-config-${counter}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `bundle-config-${counter}`;
  }
  return candidate;
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query BundleBuilderSettings {
        shop {
          rulebooks: metafield(namespace: "bundle_builder", key: "rulebooks") {
            value
          }
          categories: metafield(namespace: "bundle_builder", key: "categories") {
            value
          }
          tiers: metafield(namespace: "bundle_builder", key: "tier_rules") {
            value
          }
        }
      }`,
  );
  const data = await response.json();
  const rawRulebooks = data?.data?.shop?.rulebooks?.value || "";
  const rawCategories = data?.data?.shop?.categories?.value || "";
  const rawTiers = data?.data?.shop?.tiers?.value || "";

  let rulebooks;
  if (rawRulebooks) {
    try {
      rulebooks = normalizeRulebooks(JSON.parse(rawRulebooks));
    } catch {
      rulebooks = [DEFAULT_RULEBOOK];
    }
  } else {
    let categories = DEFAULT_RULEBOOK.categories;
    let tiers = DEFAULT_RULEBOOK.tiers;
    try {
      categories = coerceCategories(JSON.parse(rawCategories));
    } catch {
      categories = DEFAULT_RULEBOOK.categories;
    }
    try {
      tiers = coerceTierRules(JSON.parse(rawTiers), categories);
    } catch {
      tiers = DEFAULT_RULEBOOK.tiers;
    }
    rulebooks = deriveRulebooksFallback(categories, tiers);
  }

  return { rulebooks };
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const form = await request.formData();
    const rawRulebooks = form.get("rulebooks") || "[]";
    let rulebooks;
    try {
      rulebooks = normalizeRulebooks(JSON.parse(String(rawRulebooks)));
    } catch {
      return json(
        {
          ok: false,
          errors: [{ message: "Invalid rulebooks payload. Nothing was saved." }],
        },
        { status: 400 },
      );
    }

    const shopId = await admin
      .graphql(
        `#graphql
          query ShopId {
            shop {
              id
            }
          }`,
      )
      .then((r) => r.json())
      .then((r) => r?.data?.shop?.id);
    if (!shopId) {
      return json({ ok: false, errors: [{ message: "Shop ID not found" }] }, { status: 500 });
    }

    const response = await admin.graphql(
      `#graphql
        mutation SaveBundleBuilderSettings($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              namespace: "bundle_builder",
              key: "rulebooks",
              ownerId: shopId,
              type: "json",
              value: JSON.stringify(rulebooks),
            },
          ],
        },
      },
    );
    const data = await response.json();
    return json({
      ok: true,
      rulebooks,
      errors: data?.data?.metafieldsSet?.userErrors || [],
    });
  } catch (error) {
    console.error("[settings-save] action failed", error);
    return json(
      {
        ok: false,
        errors: [{ message: "Failed to save bundle settings. Check server logs." }],
      },
      { status: 500 },
    );
  }
};

export default function SettingsPage() {
  const { rulebooks } = useLoaderData();
  const settingsFetcher = useFetcher();
  const cartTransformFetcher = useFetcher();
  const isCreatingTransform =
    ["loading", "submitting"].includes(cartTransformFetcher.state) &&
    cartTransformFetcher.formMethod === "POST";
  const isSaving =
    ["loading", "submitting"].includes(settingsFetcher.state) &&
    settingsFetcher.formMethod === "POST";

  const createCartTransform = () =>
    cartTransformFetcher.submit(
      {},
      { method: "POST", action: "/app/cart-transform-create" },
    );

  const [localRulebooks, setLocalRulebooks] = useState(rulebooks);
  useEffect(() => setLocalRulebooks(rulebooks), [rulebooks]);

  const updateRulebook = (index, changes) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) =>
        i === index ? { ...rulebook, ...changes } : rulebook,
      ),
    );
  };

  const setDefaultRulebook = (index) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => ({
        ...rulebook,
        isDefault: i === index,
      })),
    );
  };

  const addRulebook = () =>
    setLocalRulebooks((current) => [
      ...current,
      {
        id: getNextRulebookId(current),
        isDefault: false,
        categories: [...DEFAULT_RULEBOOK.categories],
        tiers: [...DEFAULT_RULEBOOK.tiers],
      },
    ]);

  const removeRulebook = (index) =>
    setLocalRulebooks((current) => {
      const next = current.filter((_, i) => i !== index);
      if (!next.length) {
        return [DEFAULT_RULEBOOK];
      }
      if (!next.some((rulebook) => rulebook.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      return next;
    });

  const updateCategory = (rulebookIndex, categoryIndex, changes) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const categories = rulebook.categories.map((category, j) =>
          j === categoryIndex ? { ...category, ...changes } : category,
        );
        return { ...rulebook, categories };
      }),
    );
  };

  const addCategory = (rulebookIndex) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        if (rulebook.categories.length >= 5) return rulebook;
        return {
          ...rulebook,
          categories: [
            ...rulebook.categories,
            { key: "", label: "", min: 0, max: null },
          ],
        };
      }),
    );
  };

  const removeCategory = (rulebookIndex, categoryIndex) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const categories = rulebook.categories.filter((_, j) => j !== categoryIndex);
        return {
          ...rulebook,
          categories: categories.length ? categories : [...DEFAULT_RULEBOOK.categories],
        };
      }),
    );
  };

  const updateTier = (rulebookIndex, tierIndex, changes) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const tiers = rulebook.tiers.map((tier, j) =>
          j === tierIndex ? { ...tier, ...changes } : tier,
        );
        return { ...rulebook, tiers };
      }),
    );
  };

  const updateRequirement = (rulebookIndex, tierIndex, categoryKey, field, value) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const tiers = rulebook.tiers.map((tier, j) => {
          if (j !== tierIndex) return tier;
          return {
            ...tier,
            requirements: {
              ...tier.requirements,
              [categoryKey]: {
                ...tier.requirements?.[categoryKey],
                [field]: value,
              },
            },
          };
        });
        return { ...rulebook, tiers };
      }),
    );
  };

  const addTier = (rulebookIndex) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const requirements = rulebook.categories.reduce((acc, category) => {
          acc[category.key] = { min: 0, max: null };
          return acc;
        }, {});
        return {
          ...rulebook,
          tiers: [...rulebook.tiers, { percent: 0, requirements }],
        };
      }),
    );
  };

  const removeTier = (rulebookIndex, tierIndex) => {
    setLocalRulebooks((current) =>
      current.map((rulebook, i) => {
        if (i !== rulebookIndex) return rulebook;
        const tiers = rulebook.tiers.filter((_, j) => j !== tierIndex);
        return {
          ...rulebook,
          tiers: tiers.length ? tiers : [...DEFAULT_RULEBOOK.tiers],
        };
      }),
    );
  };

  const saveRulebooks = () =>
    settingsFetcher.submit(
      {
        rulebooks: JSON.stringify(localRulebooks),
      },
      { method: "POST" },
    );

  return (
    <s-page heading="Settings">
      <s-section heading="Bundle configurations">
        <s-paragraph>
          Define bundle configurations (categories + tiers). Each block chooses a
          configuration by ID. One configuration must be marked default.
        </s-paragraph>
        <s-stack gap="base">
          {localRulebooks.map((rulebook, rulebookIndex) => (
            <s-box
              key={`rulebook-${rulebookIndex}`}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack gap="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-text-field
                    label="Configuration ID"
                    value={rulebook.id}
                    readOnly
                  />
                  <s-checkbox
                    checked={rulebook.isDefault}
                    onChange={() => setDefaultRulebook(rulebookIndex)}
                    label="Default"
                  />
                  <s-button
                    variant="tertiary"
                    onClick={() => removeRulebook(rulebookIndex)}
                  >
                    Remove configuration
                  </s-button>
                </s-stack>

                <s-section heading="Categories">
                  <s-stack gap="base">
                    {rulebook.categories.map((category, categoryIndex) => (
                      <s-box
                        key={`category-${rulebookIndex}-${categoryIndex}`}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                      >
                        <s-stack gap="base">
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-text-field
                              label="Key"
                              value={category.key}
                              onChange={(event) =>
                                updateCategory(rulebookIndex, categoryIndex, {
                                  key: event.currentTarget.value,
                                })
                              }
                            />
                            <s-text-field
                              label="Label"
                              value={category.label}
                              onChange={(event) =>
                                updateCategory(rulebookIndex, categoryIndex, {
                                  label: event.currentTarget.value,
                                })
                              }
                            />
                            <s-number-field
                              label="Min"
                              value={String(category.min ?? 0)}
                              min={0}
                              onChange={(event) =>
                                updateCategory(rulebookIndex, categoryIndex, {
                                  min: event.currentTarget.value,
                                })
                              }
                            />
                            <s-number-field
                              label="Max (optional)"
                              value={category.max == null ? "" : String(category.max)}
                              min={0}
                              onChange={(event) =>
                                updateCategory(rulebookIndex, categoryIndex, {
                                  max: event.currentTarget.value || null,
                                })
                              }
                            />
                          </s-stack>
                          <s-button
                            variant="tertiary"
                            onClick={() => removeCategory(rulebookIndex, categoryIndex)}
                          >
                            Remove category
                          </s-button>
                        </s-stack>
                      </s-box>
                    ))}
                    <s-button
                      onClick={() => addCategory(rulebookIndex)}
                      disabled={rulebook.categories.length >= 5}
                    >
                      Add category
                    </s-button>
                  </s-stack>
                </s-section>

                <s-section heading="Tiers">
                  <s-stack gap="base">
                    {rulebook.tiers.map((tier, tierIndex) => (
                      <s-box
                        key={`tier-${rulebookIndex}-${tierIndex}`}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                      >
                        <s-stack gap="base">
                          <s-number-field
                            label="% off"
                            value={String(tier.percent)}
                            min={0}
                            max={100}
                            onChange={(event) =>
                              updateTier(rulebookIndex, tierIndex, {
                                percent: event.currentTarget.value,
                              })
                            }
                          />
                          {rulebook.categories.map((category) => (
                            <s-stack
                              key={`${rulebookIndex}-${tierIndex}-${category.key}`}
                              direction="inline"
                              gap="base"
                              alignItems="center"
                            >
                              <s-text emphasis="bold">{category.label}</s-text>
                              <s-number-field
                                label="Min"
                                value={String(tier.requirements?.[category.key]?.min ?? 0)}
                                min={0}
                                onChange={(event) =>
                                  updateRequirement(
                                    rulebookIndex,
                                    tierIndex,
                                    category.key,
                                    "min",
                                    event.currentTarget.value,
                                  )
                                }
                              />
                              <s-number-field
                                label="Max (optional)"
                                value={
                                  tier.requirements?.[category.key]?.max == null
                                    ? ""
                                    : String(tier.requirements?.[category.key]?.max)
                                }
                                min={0}
                                onChange={(event) =>
                                  updateRequirement(
                                    rulebookIndex,
                                    tierIndex,
                                    category.key,
                                    "max",
                                    event.currentTarget.value || null,
                                  )
                                }
                              />
                            </s-stack>
                          ))}
                          <s-button
                            variant="tertiary"
                            onClick={() => removeTier(rulebookIndex, tierIndex)}
                          >
                            Remove tier
                          </s-button>
                        </s-stack>
                      </s-box>
                    ))}
                    <s-button onClick={() => addTier(rulebookIndex)}>Add tier</s-button>
                  </s-stack>
                </s-section>
              </s-stack>
            </s-box>
          ))}

          <s-stack direction="inline" gap="base">
            <s-button onClick={addRulebook}>Add configuration</s-button>
            <s-button
              variant="primary"
              onClick={saveRulebooks}
              {...(isSaving ? { loading: true } : {})}
            >
              Save configurations
            </s-button>
          </s-stack>
          {settingsFetcher.data?.errors?.length ? (
            <s-banner tone="critical">
              {settingsFetcher.data.errors[0]?.message ||
                "Failed to save configurations."}
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Cart transform setup">
        <s-paragraph>
          Create the cart transform for this store (requires Functions support).
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={createCartTransform}
            {...(isCreatingTransform ? { loading: true } : {})}
          >
            Create cart transform
          </s-button>
        </s-stack>
        {cartTransformFetcher.data && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0 }}>
              <code>{JSON.stringify(cartTransformFetcher.data, null, 2)}</code>
            </pre>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
