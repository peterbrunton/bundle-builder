const SIGNATURE_VERSION = "v2";

const toPositiveInt = (value, fallback = 0) => {
  const num = Number.parseInt(String(value), 10);
  if (Number.isNaN(num) || num < 0) return fallback;
  return num;
};

const toVariantGid = (id) => {
  const value = String(id || "").trim();
  if (!value) return "";
  return value.startsWith("gid://shopify/ProductVariant/")
    ? value
    : `gid://shopify/ProductVariant/${value}`;
};

export const canonicalizeSignatureComponents = (components) =>
  (Array.isArray(components) ? components : [])
    .map((component) => {
      const id = toVariantGid(component?.id);
      if (!id) return null;
      return {
        id,
        quantity: Math.max(1, toPositiveInt(component?.quantity, 1)),
        role: String(component?.role || "component"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      return a.quantity - b.quantity;
    });

export const buildBundleSignaturePayload = ({
  bundleId,
  rulebookId,
  components,
  discountedCents,
  signatureVersion = SIGNATURE_VERSION,
}) =>
  JSON.stringify({
    version: String(signatureVersion || SIGNATURE_VERSION),
    bundle_id: String(bundleId || ""),
    rulebook_id: String(rulebookId || ""),
    components: canonicalizeSignatureComponents(components),
    discounted_cents: Math.max(0, toPositiveInt(discountedCents, 0)),
  });

export { SIGNATURE_VERSION };
