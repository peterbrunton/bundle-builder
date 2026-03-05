import crypto from "crypto";
import { authenticate } from "../shopify.server";
import {
  buildBundleSignaturePayload,
  SIGNATURE_VERSION,
} from "../utils/bundle-signature.server";

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const safeHost = (value) => {
  if (!value) return "";
  const host = String(value).trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return "";
  return host;
};

const hostFromUrl = (value) => {
  if (!value) return "";
  try {
    return safeHost(new URL(value).host);
  } catch {
    return "";
  }
};

const firstHeaderHost = (value) => {
  if (!value) return "";
  const first = String(value).split(",")[0]?.trim() || "";
  return safeHost(first);
};

const getStorefrontHost = (request, shopDomain) => {
  const appHost = hostFromUrl(process.env.SHOPIFY_APP_URL || "");
  const candidates = [
    hostFromUrl(request.headers.get("origin")),
    hostFromUrl(request.headers.get("referer")),
    firstHeaderHost(request.headers.get("x-forwarded-host")),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && candidate !== appHost) return candidate;
  }

  return safeHost(shopDomain);
};

const normalizeComponents = (components) =>
  components
    .map((component) => {
      const id = component?.id;
      if (!id) return null;
      return {
        id: String(id),
        quantity: Math.max(1, Math.floor(Number(component?.quantity) || 1)),
        role: component?.role || "component",
        unitCents: Math.max(0, Math.floor(Number(component?.unitCents) || 0)),
      };
    })
    .filter(Boolean);

const getCounts = (components) =>
  components.reduce((acc, component) => {
    const role = component.role || "unknown";
    acc[role] = (acc[role] || 0) + component.quantity;
    return acc;
  }, {});

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

const DEFAULT_TIER_RULES = [
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
];

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
      products: Array.isArray(category?.products)
        ? category.products.map((handle) => String(handle).trim()).filter(Boolean)
        : [],
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

const getTier = (rules, counts) => {
  const matches = rules.filter((rule) =>
    Object.entries(rule.requirements || {}).every(([key, req]) => {
      const count = counts[key] || 0;
      if (count < (req?.min ?? 0)) return false;
      if (req?.max != null && count > req.max) return false;
      return true;
    }),
  );

  return matches.reduce((best, tier) => {
    if (!best) return tier;
    return Number(tier?.percent ?? 0) > Number(best?.percent ?? 0) ? tier : best;
  }, null);
};

const secretCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adminGraphqlWithRetry = async (admin, query, options) => {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await admin.graphql(query, options);
      if (response?.ok === false && response.status >= 500) {
        lastError = new Error(`Shopify admin error ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(200 * (attempt + 1));
  }
  throw lastError || new Error("Shopify admin request failed");
};

const enrichComponentsWithUnitCents = async (admin, components) => {
  const variantIds = components.map((component) =>
    component.id.startsWith("gid://")
      ? component.id
      : `gid://shopify/ProductVariant/${component.id}`,
  );
  const variantResponse = await adminGraphqlWithRetry(
    admin,
    `#graphql
      query VariantPrices($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            price
          }
        }
      }`,
    { variables: { ids: variantIds } },
  );
  const variantData = await variantResponse.json();
  const priceMap = new Map();
  (variantData?.data?.nodes || []).forEach((node) => {
    if (node?.id && node?.price != null) {
      priceMap.set(node.id, node.price);
    }
  });

  return components.map((component) => {
    const gid = component.id.startsWith("gid://")
      ? component.id
      : `gid://shopify/ProductVariant/${component.id}`;
    const price = Number(priceMap.get(gid) || 0);
    const unitCents = Math.max(0, Math.round(price * 100));
    return {
      ...component,
      id: gid,
      unitCents,
    };
  });
};

const toVariantGid = (variantId) =>
  String(variantId || "").startsWith("gid://")
    ? String(variantId)
    : `gid://shopify/ProductVariant/${variantId}`;

const toStorefrontVariantId = (variantId) => {
  const value = String(variantId || "").trim();
  if (!value) return "";
  if (/^\d+$/.test(value)) return value;
  const match = value.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
  return match ? match[1] : "";
};

const loadParentVariantSnapshot = async (admin, parentVariantId) => {
  const id = toVariantGid(parentVariantId);
  const response = await adminGraphqlWithRetry(
    admin,
    `#graphql
      query ParentVariantSnapshot($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            title
            inventoryPolicy
            inventoryQuantity
            product {
              id
              title
              status
            }
          }
        }
      }`,
    { variables: { id } },
  );
  const data = await response.json();
  return data?.data?.node || null;
};

const normalizeRulebooks = (rulebooks) => {
  if (!Array.isArray(rulebooks) || rulebooks.length === 0) {
    return [DEFAULT_RULEBOOK];
  }
  const normalized = rulebooks
    .map((rulebook, index) => {
      const categories = coerceCategories(rulebook?.categories);
      const tiers = coerceTierRules(rulebook?.tiers, categories);
      return {
        id: String(rulebook?.id || "").trim() || `bundle-config-${index + 1}`,
        isDefault: Boolean(rulebook?.isDefault),
        categories,
        tiers,
      };
    })
    .filter((rulebook) => rulebook.id);
  if (!normalized.length) return [DEFAULT_RULEBOOK];
  if (!normalized.some((rulebook) => rulebook.isDefault)) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }
  return normalized;
};

const loadRulebooks = async (admin) => {
  const response = await adminGraphqlWithRetry(
    admin,
    `#graphql
      query BundleBuilderRulebooks {
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
  if (rawRulebooks) {
    try {
      return normalizeRulebooks(JSON.parse(rawRulebooks));
    } catch {
      return [DEFAULT_RULEBOOK];
    }
  }
  let categories = DEFAULT_RULEBOOK.categories;
  let tiers = DEFAULT_RULEBOOK.tiers;
  try {
    categories = coerceCategories(JSON.parse(data?.data?.shop?.categories?.value || ""));
  } catch {
    categories = DEFAULT_RULEBOOK.categories;
  }
  try {
    tiers = coerceTierRules(JSON.parse(data?.data?.shop?.tiers?.value || ""), categories);
  } catch {
    tiers = DEFAULT_RULEBOOK.tiers;
  }
  return normalizeRulebooks([
    { id: "bundle-config-1", isDefault: true, categories, tiers },
  ]);
};

const selectRulebook = (rulebooks, rulebookId) => {
  if (rulebookId) {
    const found = rulebooks.find((rulebook) => rulebook.id === rulebookId);
    if (found) return found;
  }
  return rulebooks.find((rulebook) => rulebook.isDefault) || rulebooks[0];
};

const getStorefrontCookie = async (shop, password) => {
  if (!password) return "";
  const body = new URLSearchParams({ password });
  const response = await fetch(`https://${shop}/password`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: `https://${shop}`,
      Referer: `https://${shop}/password`,
    },
    body,
  });
  const setCookie = response.headers.get("set-cookie") || "";
  if (!setCookie) {
    console.error("[bundle-add] password unlock failed", {
      status: response.status,
    });
  }
  return setCookie;
};

const getOrCreateSignatureSecret = async (admin, shop) => {
  const cached = secretCache.get(shop);
  if (cached) return cached;

  const response = await adminGraphqlWithRetry(
    admin,
    `#graphql
      query CartTransformsWithSecret {
        shop {
          id
          cartTransformId: metafield(namespace: "bundle_builder", key: "cart_transform_id") {
            value
          }
          cartTransformFunctionId: metafield(namespace: "bundle_builder", key: "cart_transform_function_id") {
            value
          }
        }
        cartTransforms(first: 10) {
          nodes {
            id
            functionId
            metafield(namespace: "bundle_builder", key: "signature_secret") {
              value
            }
          }
        }
      }`,
  );
  const data = await response.json();
  const shopId = data?.data?.shop?.id;
  const storedTransformId = data?.data?.shop?.cartTransformId?.value || "";
  const storedFunctionId = data?.data?.shop?.cartTransformFunctionId?.value || "";
  const cartTransforms = data?.data?.cartTransforms?.nodes || [];
  let cartTransform =
    (storedTransformId
      ? cartTransforms.find((transform) => transform?.id === storedTransformId)
      : null) ||
    (storedFunctionId
      ? cartTransforms.find(
          (transform) => String(transform?.functionId || "") === String(storedFunctionId),
        )
      : null);

  if (!cartTransform && cartTransforms.length === 1) {
    cartTransform = cartTransforms[0];
    if (shopId && cartTransform?.id) {
      await adminGraphqlWithRetry(
        admin,
        `#graphql
          mutation SaveBundleCartTransformPointers($metafields: [MetafieldsSetInput!]!) {
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
                key: "cart_transform_id",
                ownerId: shopId,
                type: "single_line_text_field",
                value: String(cartTransform.id),
              },
              {
                namespace: "bundle_builder",
                key: "cart_transform_function_id",
                ownerId: shopId,
                type: "single_line_text_field",
                value: String(cartTransform.functionId || ""),
              },
            ],
          },
        },
      );
    }
  }

  if (!cartTransform && cartTransforms.length > 1) {
    throw new Error("Multiple cart transforms found. Set bundle_builder.cart_transform_id first.");
  }
  if (!cartTransform?.id) {
    const fallback =
      process.env.BUNDLE_SIGNATURE_SECRET || process.env.SHOPIFY_API_SECRET;
    if (fallback) {
      console.warn("[bundle-add] cart transform missing, using fallback secret");
      secretCache.set(shop, fallback);
      return fallback;
    }
    throw new Error("Cart transform not found");
  }

  const existingSecret = cartTransform?.metafield?.value;
  if (existingSecret) return existingSecret;

  const secret = crypto.randomBytes(32).toString("hex");
  const setResponse = await adminGraphqlWithRetry(
    admin,
    `#graphql
      mutation SetCartTransformSecret($metafields: [MetafieldsSetInput!]!) {
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
            ownerId: cartTransform.id,
            namespace: "bundle_builder",
            key: "signature_secret",
            type: "single_line_text_field",
            value: secret,
          },
        ],
      },
    },
  );
  const setData = await setResponse.json();
  const errors = setData?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors[0].message);
  }
  secretCache.set(shop, secret);
  return secret;
};

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin || !session?.shop) {
      return json({ error: "Invalid proxy session" }, { status: 401 });
    }

    const url = new URL(request.url);
    const pathPrefix = url.searchParams.get("path_prefix") || "";

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    const bundleId = payload?.bundleId || "";
    const rulebookId = payload?.rulebookId || "";
    const components = normalizeComponents(payload?.components || []);
    const parentVariantId = payload?.parentVariantId || "";
    const cartToken = payload?.cartToken ? String(payload.cartToken) : "";
    if (!bundleId || components.length === 0 || !parentVariantId) {
      return json({ error: "Invalid bundle data" }, { status: 400 });
    }
    if (!/^(gid:\/\/shopify\/ProductVariant\/\d+|\d+)$/.test(String(parentVariantId))) {
      return json({ error: "Invalid parent variant" }, { status: 400 });
    }
    if (components.length > 20) {
      return json({ error: "Too many components" }, { status: 400 });
    }
    for (const component of components) {
      if (!/^(gid:\/\/shopify\/ProductVariant\/\d+|\d+)$/.test(component.id)) {
        return json({ error: "Invalid component id" }, { status: 400 });
      }
    }

    const secret = await getOrCreateSignatureSecret(admin, session.shop);
    const rulebooks = await loadRulebooks(admin);
    const rulebook = selectRulebook(rulebooks, rulebookId);
    const parentVariantGid = toVariantGid(parentVariantId);
    const parentVariantStorefrontId =
      toStorefrontVariantId(parentVariantId) || toStorefrontVariantId(parentVariantGid);
    const parentVariantSnapshot = await loadParentVariantSnapshot(
      admin,
      parentVariantId,
    ).catch((error) => {
      console.error("[bundle-add] parent snapshot failed", {
        parentVariantId,
        error: String(error?.message || error),
      });
      return null;
    });
    const { categories, tiers } = rulebook;

    const categoryMap = new Map(
      categories.map((category) => [category.key, category]),
    );
    for (const component of components) {
      if (!categoryMap.has(component.role)) {
        return json({ error: "Invalid component role" }, { status: 400 });
      }
    }

    const pricedComponents = await enrichComponentsWithUnitCents(admin, components);

    const compareAtCents = pricedComponents.reduce((sum, component) => {
      return sum + component.unitCents * component.quantity;
    }, 0);

    const counts = getCounts(components);
    const tier = getTier(tiers, counts);
    const percent = tier ? tier.percent : 0;
    const discountedCents = Math.max(
      0,
      Math.round(compareAtCents * (1 - percent / 100)),
    );
    const discountLabel = percent ? `Bundle ${percent}% off` : "";

    const signaturePayload = buildBundleSignaturePayload({
      bundleId,
      rulebookId: rulebook.id,
      components: pricedComponents,
      discountedCents,
      signatureVersion: SIGNATURE_VERSION,
    });
    const signature = crypto
      .createHmac("sha256", secret)
      .update(signaturePayload)
      .digest("hex");

    const items = [
      {
        id: parentVariantStorefrontId || parentVariantId,
        quantity: 1,
        properties: {
          _bundle_id: bundleId,
          _bundle_instance_id: `${bundleId}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          _bundle_rulebook: rulebook.id,
          _bundle_version: "v1",
          _bundle_components: JSON.stringify(pricedComponents),
          _bundle_discount_label: discountLabel,
          _bundle_compare_at_cents: String(compareAtCents || 0),
          _bundle_discounted_cents: String(discountedCents || 0),
          _bundle_signature: signature,
          _bundle_signature_version: SIGNATURE_VERSION,
        },
      },
    ];

    console.info("[bundle-add]", {
      shop: session.shop,
      bundleId,
      parentVariantId,
      parentVariantGid,
      parentVariantStorefrontId,
      parentVariantSnapshot,
      componentCount: components.length,
      compareAtCents,
      discountedCents,
    });

    // Try the shopper's storefront host first (market/channel accurate), then
    // fall back to canonical myshopify host for resilience.
    const storefrontHostFromRequest = getStorefrontHost(request, session.shop);
    const storefrontHostCanonical = safeHost(session.shop);
    const storefrontHosts = [
      ...new Set([storefrontHostFromRequest, storefrontHostCanonical].filter(Boolean)),
    ];
    const cookie = request.headers.get("cookie") || "";
    const storefrontPassword = process.env.BUNDLE_STOREFRONT_PASSWORD || "";
    const cartCookieHeader = cartToken ? `cart=${cartToken}` : "";
    const baseCookieHeader = [cartCookieHeader, cookie].filter(Boolean).join("; ");
    const attemptHostAdd = async (host) => {
      const origin = `https://${host}`;
      let response = await fetch(`${origin}/cart/add.js`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: origin,
          Referer: `${origin}/`,
          ...(baseCookieHeader ? { Cookie: baseCookieHeader } : {}),
        },
        body: JSON.stringify({ items }),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") || "";
        if (location.includes("/password") && storefrontPassword) {
          const passwordCookie = await getStorefrontCookie(host, storefrontPassword);
          const unlockedCookieHeader = [cartCookieHeader, cookie, passwordCookie]
            .filter(Boolean)
            .join("; ");
          response = await fetch(`${origin}/cart/add.js`, {
            method: "POST",
            redirect: "manual",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Origin: origin,
              Referer: `${origin}/`,
              ...(unlockedCookieHeader ? { Cookie: unlockedCookieHeader } : {}),
            },
            body: JSON.stringify({ items }),
          });
        }
      }

      return { host, origin, response };
    };

    let cartResponse = null;
    let storefrontHost = storefrontHosts[0] || "";
    let storefrontOrigin = storefrontHost ? `https://${storefrontHost}` : "";
    const addAttempts = [];
    for (const host of storefrontHosts) {
      const { origin, response } = await attemptHostAdd(host);
      const location = response.headers.get("location") || "";
      const attempt = {
        host,
        status: response.status,
        location,
      };
      if (response.ok) {
        addAttempts.push(attempt);
        cartResponse = response;
        storefrontHost = host;
        storefrontOrigin = origin;
        console.info("[bundle-add] cart/add success", attempt);
        break;
      }

      const detail = await response.text().catch(() => "");
      attempt.detail = detail?.slice(0, 500);
      addAttempts.push(attempt);
      console.warn("[bundle-add] cart/add attempt failed", attempt);
    }

    if (!cartResponse) {
      const lastAttempt = addAttempts[addAttempts.length - 1] || {};
      console.error("[bundle-add] cart/add failed all hosts", {
        parentVariantId,
        parentVariantGid,
        parentVariantSnapshot,
        attempts: addAttempts,
      });
      return json(
        {
          error: "Cart add failed",
          detail: lastAttempt.detail || "All cart/add attempts failed",
          attempts: addAttempts.map(({ host, status, location }) => ({
            host,
            status,
            location,
          })),
        },
        { status: lastAttempt.status || 502 },
      );
    }

    const cartAddPayload = await cartResponse.json().catch(() => null);
    const setCookie = cartResponse.headers.get("set-cookie");
    const cartCookie = setCookie || cookie;
    const cart = await fetch(`${storefrontOrigin}/cart.js`, {
      headers: {
        Accept: "application/json",
        ...(cartCookie ? { Cookie: cartCookie } : {}),
      },
    }).then((res) => (res.ok ? res.json() : null));
    const cartTokenValue = cart?.token || "";

    const response = json(
      {
        ok: true,
        bundleId,
        compareAtCents,
        discountedCents,
        discountLabel,
        signature,
        signatureVersion: SIGNATURE_VERSION,
        pathPrefix,
        storefrontHost,
        addAttempts: addAttempts.map(({ host, status, location }) => ({
          host,
          status,
          location,
        })),
        cartAdd: cartAddPayload,
        cart,
        cartToken: cartTokenValue,
      },
      { status: 200 },
    );
    if (setCookie) {
      response.headers.set("Set-Cookie", setCookie);
    }
    return response;
  } catch (error) {
    console.error("[bundle-add] unhandled error", error);
    return json(
      { error: "Proxy add failed", detail: String(error?.message || error) },
      { status: 500 },
    );
  }
};

export const loader = async () =>
  json({ error: "Method not allowed" }, { status: 405 });
