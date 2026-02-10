# Bundle Builder Architecture (Shopify Plus / Plan A)

## 1) Goal
Allow build-your-own bundles with correct pricing and a clear cart display using Shopify-supported primitives.

## 2) Source of Truth
- Bundle price is computed server-side (app backend).
- Frontend only sends components; it does **not** set the final price.

## 3) Cart Structure
- Cart contains one **parent bundle line** per bundle (product: "Bundle Group").
- Parent line properties:
  - `_bundle_id`
  - `_bundle_version`
  - `_bundle_components` (JSON of variant IDs + qty + role)
  - `_bundle_discount_label`
  - `_bundle_compare_at_cents`
  - `_bundle_discounted_cents`
  - `_bundle_signature` (HMAC signature)

## 4) App Proxy (Pricing Authority)
- Endpoint: `/apps/bundle-builder-1/price`
- The storefront uses a configurable proxy path (theme setting) to avoid hard‑coding.
- Validates Shopify app proxy request using `authenticate.public.appProxy`.
- Computes:
  - `compareAtCents` (sum of component prices * qty)
  - `discountedCents` (tiered discount)
  - `discountLabel`
  - `signature` (HMAC with secret stored on CartTransform metafield)
- Returns these values to the storefront.

## 5) Cart Transform (Plus-only price update)
- Uses `lineExpand` to show component lines under the parent.
- Uses `update` to override **parent price** using `_bundle_discounted_cents`.
- Verifies `_bundle_signature` using `cartTransform` metafield `bundle_builder.signature_secret`.

## 6) Discount Function
- Optional. If used, apply to **parent line** only.
- If the price is already discounted in Cart Transform, the Discount Function should be disabled to avoid double-discounting.

## 7) UI
- Cart UI groups by `_bundle_id`.
- Parent title uses `% Off Bundle` from `_bundle_discount_label`.
- Component list shown under parent.

## 8) Why This Works
- Shopify Plus allows `update` operation in Cart Transform.
- Parent line controls cart total; expanded lines are display/fulfillment only.

## 9) Operational Notes
- Ensure App Proxy is configured in Shopify Admin:
  - Subpath: `bundle-builder-1`
  - Proxy URL: `https://<APP_URL>/apps/bundle-builder-1`
- App must have offline session to call Admin API in proxy route.
 - If the proxy path is customized in Admin, update the theme setting to match.

## 10) Implementation Handoff (New Developer Checklist)
1. Configure the App Proxy (Admin → Apps → App Proxy).
2. Confirm the proxy route responds:
   - `POST /apps/bundle-builder-1/price` returns JSON with `discountedCents`, `compareAtCents`, `signature`.
3. Confirm the proxy auth uses `authenticate.public.appProxy`.
3. Verify Cart Transform is registered and enabled.
4. Ensure the Cart Transform reads:
   - `_bundle_components`, `_bundle_discounted_cents`, `_bundle_signature`, `_bundle_id`, `_bundle_version`.
5. Confirm the Cart Transform:
   - Applies `update` to parent price (Plus only).
   - Applies `lineExpand` to show components.
6. In the bundle builder frontend:
   - Call pricing endpoint before `/cart/add.js`.
   - Store `_bundle_compare_at_cents`, `_bundle_discounted_cents`, `_bundle_signature` on the parent line.
7. Disable Discount Function unless explicitly needed (avoid double-discount).
8. QA in storefront:
   - Add a bundle and confirm cart total matches discounted price.
   - Confirm expanded component lines render under the parent.
