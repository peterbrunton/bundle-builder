# Bundle Builder Technical Deep Dive (Single Source of Truth)

> Status: Canonical documentation for this project.
> Last updated: 2026-02-18
>
> If any other document conflicts with this one, this document wins.

## 1. Scope and intent

This document explains the current implementation of the Bundle Builder app end-to-end, for:

- engineers maintaining/extending the codebase
- operators deploying/debugging in production
- non-specialist technical stakeholders who need to understand how bundle pricing is enforced

It covers:

- app architecture
- request/data flow across storefront, app proxy, admin API, and Shopify Functions
- signing and validation model
- deployment/runtime behavior
- code review findings and recommendations

---

## 2. High-level architecture

The system is split into three runtime layers:

1. Embedded app backend (React Router + Shopify Admin API)
- Handles app admin UI (`/app/settings`, `/app/cart-transform-create`)
- Persists bundle rulebooks in shop metafields
- Hosts app proxy endpoints

2. Theme app extension (Liquid + JS)
- Renders bundle UI on storefront product page
- Calls app proxy for config and pricing
- Sends validated bundle payload to app proxy add endpoint

3. Cart Transform function (Rust)
- Verifies HMAC signature on bundle payload
- Expands parent bundle line into component lines
- Applies per-component fixed prices so discounted total is preserved

Primary files:

- Backend config and auth: `app/shopify.server.js`
- Settings UI + persistence: `app/routes/app.settings.jsx`
- Cart transform setup action: `app/routes/app.cart-transform-create.jsx`
- Proxy pricing endpoint: `app/routes/apps.bundle-builder-1.price.jsx`
- Proxy add endpoint: `app/routes/apps.bundle-builder-1.add-bundle.jsx`
- Signature canonicalization: `app/utils/bundle-signature.server.js`
- Theme block markup/schema: `extensions/bundle-builder-ui/blocks/bundle-builder.liquid`
- Theme runtime logic (readable): `extensions/bundle-builder-ui/assets/bundle-builder.readable.js`
- Cart transform function: `extensions/bundle-cart-transform/src/lib.rs`
- Cart transform input query: `extensions/bundle-cart-transform/src/cart_transform_run.graphql`

---

## 3. Runtime and platform configuration

### 3.1 Shopify app config

`shopify.app.toml`:

- `application_url = "https://build-your-own-bundle.fly.dev"`
- Embedded app enabled
- App proxy configured:
  - prefix: `apps`
  - subpath: `bundle-builder-1`
  - proxy URL path: `/apps/bundle-builder-1`
- Scopes include:
  - `read_products`
  - `write_products`
  - `write_cart_transforms`
  - `write_app_proxy`

### 3.2 Fly runtime

`fly.toml`:

- internal port: `3000`
- auto start/stop machines enabled
- one mounted volume at `/data` (SQLite Prisma DB)
- `min_machines_running = 1` (helps cold-start behavior but does not eliminate all startup latency scenarios)

### 3.3 Session storage

Prisma session store (`Session` model in `prisma/schema.prisma`) is used by Shopify auth/session middleware. The app uses offline sessions for Admin API work in proxy and admin routes.

---

## 4. Data model and contracts

## 4.1 Shop metafields (namespace `bundle_builder`)

Persisted by settings and setup flows:

- `rulebooks` (JSON)
- `cart_transform_id` (string)
- `cart_transform_function_id` (string)
- `signature_secret` (stored on the CartTransform owner, not shop owner)

### 4.2 Rulebook shape

Each rulebook contains:

- `id` (e.g. `bundle-config-1`)
- `isDefault` (boolean)
- `categories[]`
  - `key`, `label`, `min`, `max`
- `tiers[]`
  - `percent`
  - `requirements` keyed by category key with `min/max`

Normalization occurs in:

- `app/routes/app.settings.jsx`
- `app/routes/apps.bundle-builder-1.price.jsx`
- `app/routes/apps.bundle-builder-1.add-bundle.jsx`

### 4.3 Line item properties written on parent bundle line

Set in `app/routes/apps.bundle-builder-1.add-bundle.jsx`:

- `_bundle_id`
- `_bundle_instance_id`
- `_bundle_rulebook`
- `_bundle_version`
- `_bundle_components` (JSON, includes resolved `unit_cents`)
- `_bundle_discount_label`
- `_bundle_compare_at_cents`
- `_bundle_discounted_cents`
- `_bundle_signature`
- `_bundle_signature_version`

These properties are the source data for Cart Transform verification and expansion.

### 4.4 Signature payload contract (`v2`)

Defined in `app/utils/bundle-signature.server.js`:

- canonical component ID normalization to ProductVariant GID
- sorted canonical component array (role, id, quantity)
- non-negative integer coercion for cents and quantities
- JSON payload:
  - `version`
  - `bundle_id`
  - `rulebook_id`
  - `components[]`
  - `discounted_cents`

HMAC-SHA256 is computed server-side and verified in Rust function.

---

## 5. End-to-end flow

## 5.1 Admin settings flow (`/app/settings`)

Code: `app/routes/app.settings.jsx`

1. Loader authenticates admin request.
2. Reads metafields (`rulebooks`, fallback legacy `categories` and `tier_rules`).
3. Normalizes into UI-safe `rulebooks`.
4. User edits categories/tiers/default config.
5. Action receives serialized `rulebooks`, normalizes again.
6. Action resolves `shop.id` via GraphQL query.
7. Writes `rulebooks` metafield via `metafieldsSet`.
8. Returns `{ ok, errors, rulebooks }`.

Failure handling:

- invalid JSON payload => `400`
- missing shop id => `500`
- catch-all handler logs `[settings-save] action failed` and returns `500`

## 5.2 Cart Transform setup flow (`/app/cart-transform-create`)

Code: `app/routes/app.cart-transform-create.jsx`

1. Authenticates admin.
2. Fetches `shop.id`.
3. Checks `cartTransforms(first: 10)`:
   - if existing transform found => returns `skipped: true` and current transforms.
4. Creates transform with function handle `bundle-cart-transform`.
5. On success, writes shop pointers:
   - `cart_transform_id`
   - `cart_transform_function_id`

## 5.3 Storefront config loading flow

Liquid block: `extensions/bundle-builder-ui/blocks/bundle-builder.liquid`
JS runtime: `extensions/bundle-builder-ui/assets/bundle-builder.readable.js`

1. Liquid injects selected rulebook categories (if available) and default/fallback display.
2. JS initializes selected components and UI state.
3. JS calls proxy `GET /apps/bundle-builder-1/price?config=1&rulebookId=...`.
4. If successful:
   - updates offers list in DOM
   - caches `{ categories, tiers }` in localStorage key `bundle_builder_rulebook_<id>`
5. Retry strategy:
   - attempt timeouts: 12s, 8s, 8s
   - then periodic retries every 3s up to 10 cycles
   - warning banner if unavailable

## 5.4 Pricing quote flow

Route: `app/routes/apps.bundle-builder-1.price.jsx` (`action` POST)

1. Authenticate app proxy request.
2. Validate payload (bundle id + components).
3. Resolve signature secret:
   - prefer transform pointer metafields
   - if one transform exists and pointer missing, backfill pointers
   - if multiple transforms and no pointer match, throw explicit error
4. Load rulebooks and select requested/default rulebook.
5. Enrich components with live variant prices from Admin API.
6. Compute:
   - `compareAtCents`
   - matching tier (highest percent among matches)
   - `discountedCents`
   - `discountLabel`
7. Build canonical signature payload and HMAC signature.
8. Return pricing + signature to storefront.

Also supports:

- `GET ?config=1` -> returns selected `rulebook`
- `GET ?ping=1` -> health/prefix echo

## 5.5 Add bundle to cart flow

Route: `app/routes/apps.bundle-builder-1.add-bundle.jsx` (`action` POST)

1. Authenticate app proxy request.
2. Validate component ids/roles/counts/parent variant id.
3. Resolve same rulebook + signature secret process as pricing route.
4. Recompute and sign server-authoritative payload.
5. Build parent line item with bundle properties.
6. POST to storefront `cart/add.js`:
   - robust host detection
   - optional password-page unlock support for protected storefront
   - cookie propagation and cart token handling
7. Fetch resulting `cart.js`, return cart + token.
8. Logs:
   - `[bundle-add]` for computed payload
   - error logs for redirects/422/cart failures

---

## 6. Cart Transform function internals

Code: `extensions/bundle-cart-transform/src/lib.rs`

Input query: `extensions/bundle-cart-transform/src/cart_transform_run.graphql`

Per cart line:

1. Read bundle attributes from parent line:
   - `_bundle_components`
   - `_bundle_discounted_cents`
   - `_bundle_signature`
   - `_bundle_signature_version`
   - `_bundle_id`
   - `_bundle_rulebook`
2. Parse and canonicalize components.
3. Verify HMAC signature using transform metafield `signature_secret`.
4. Build expanded child lines with:
   - variant IDs
   - quantity = component qty * parent line qty
   - attributes (`_bundle_id`, `_bundle_role`, `_bundle_version`)
5. Price allocation:
   - compute base totals per component from `unit_cents`
   - allocate target discounted total proportionally using largest-remainder method to preserve cent-accurate totals
   - apply `FixedPricePerUnit` per expanded line
6. Emit `lineExpand` operation only (no separate lineUpdate needed with current implementation).

Security property:

- Any tampering in bundle components/discounted cents/rulebook/bundle id invalidates signature; allocation only happens when signature verifies.

---

## 7. UI extension behavior

Liquid block (`bundle-builder.liquid`) responsibilities:

- Select rulebook by:
  - explicit `bundle_config_id`
  - else default rulebook
  - else first rulebook
- Render category panels and product selectors
- Render offers list
- Include settings schema for style/product assignment/proxy path

JS runtime (`bundle-builder.readable.js`) responsibilities:

- Selection toggling and min/max validation by role
- Bundle preview tiles
- Active tier highlighting
- Dynamic config fetch with retries
- Pricing request before add
- Add-bundle request and cart update event dispatch
- Proxy path discovery/caching (`bundle_builder_proxy_path`)

Minified runtime (`bundle-builder.js`) is generated from readable source.

---

## 8. Route map

Primary app routes:

- `GET /app/settings` -> settings UI + loader
- `POST /app/settings` -> save rulebooks metafield
- `POST /app/cart-transform-create` -> create transform + pointer metafields
- `POST /apps/bundle-builder-1/price` -> quote pricing/signature
- `GET /apps/bundle-builder-1/price?config=1` -> return rulebook config
- `POST /apps/bundle-builder-1/add-bundle` -> add signed parent line to cart
- `POST /webhooks/app/uninstalled` -> delete sessions
- `POST /webhooks/app/scopes_update` -> update session scopes

Compatibility route:

- `app/routes/apps.bundle-builder.price.jsx` exists as legacy/no-suffix variant with near-duplicate logic.

---

## 9. Deployment and operations

Server deploy:

1. `npm run build`
2. `fly deploy -a build-your-own-bundle --strategy immediate`
3. `fly machine restart <id> -a build-your-own-bundle` (optional immediate reload)

Extension deploy:

1. `shopify app deploy`
2. refresh storefront/admin where relevant

Useful logs:

- Save failures: grep `POST /app/settings.data`, `[settings-save]`
- Proxy pricing/add: grep `[app-proxy]`, `[bundle-add]`, `POST /apps/bundle-builder-1/...`
- Transform setup: grep `[cart-transform-create]`

---

## 10. Code review findings

Ordered by severity.

### 10.1 Medium: duplicated proxy pricing code increases drift risk

Files:

- `app/routes/apps.bundle-builder-1.price.jsx`
- `app/routes/apps.bundle-builder.price.jsx`

Risk:

- behavior/security fixes can land in one route and be missed in the other
- difficult debugging if one path is accidentally used in production

Recommendation:

- extract shared pricing logic into `app/services/bundle-pricing.server.js`
- keep one route as canonical and make the other a thin compatibility wrapper

### 10.2 Medium: settings action reports `ok: true` even if `metafieldsSet.userErrors` exist

File:

- `app/routes/app.settings.jsx`

Risk:

- UI may appear successful while Shopify rejected writes

Recommendation:

- set `ok` based on `userErrors.length === 0`
- surface all user errors in banner/toast

### 10.3 Low: stale import

File:

- `app/routes/app.settings.jsx`

Issue:

- `useMemo` imported but unused (build warning)

Recommendation:

- remove unused import

### 10.4 Low: historical fallback fields still read

Files:

- settings/proxy routes still read legacy `categories` + `tier_rules` when `rulebooks` absent

Observation:

- useful for migration compatibility but adds complexity

Recommendation:

- keep until all stores are migrated, then remove fallback path in a cleanup release

---

## 11. Test strategy (practical checklist)

### 11.1 Settings

- Update category label and tier values
- Confirm `POST /app/settings.data` returns `200`
- Reload settings, verify persistence

### 11.2 Storefront config loading

- Hard refresh and load block
- Verify offers list reflects saved rulebook
- Simulate cold start: ensure retry eventually loads config

### 11.3 Pricing and add flow

- Select valid combinations for each tier
- Confirm returned `discountedCents` and `signature` from `/price`
- Add to cart via `/add-bundle`, confirm `200`
- Validate parent line properties include signature and cents fields

### 11.4 Signature integrity

- Tamper `_bundle_discounted_cents` in cart payload test fixture
- Confirm transform does not apply signed allocation behavior when invalid

### 11.5 Cart transform outcomes

- Parent line expands into expected component lines
- Line totals sum to discounted bundle total (cent-accurate allocation)
- Multi-quantity parent line scales correctly

### 11.6 Failure cases

- Sold-out component should return `422` from `cart/add.js`
- Missing/incorrect app proxy path should show user warning

---

## 12. Suggested next refactor plan

1. Consolidate duplicated pricing/add/shared helpers into service modules.
2. Introduce typed shared schema (`zod`/TS types) for rulebook and bundle payload validation.
3. Add integration tests for:
- settings save success/error paths
- proxy pricing with multiple transform scenarios
- signature verification parity (Node vs Rust canonical payload)
4. Add explicit UI save confirmation toast and “last saved” timestamp.

---

## 13. Quick reference

### Primary write paths

- Rulebooks saved at: `shop.metafields.bundle_builder.rulebooks`
- Signature secret stored on: `CartTransform.metafield(bundle_builder.signature_secret)`

### Parent line properties that matter most

- `_bundle_components`
- `_bundle_discounted_cents`
- `_bundle_signature`
- `_bundle_signature_version`

### Transform pointer metafields

- `bundle_builder.cart_transform_id`
- `bundle_builder.cart_transform_function_id`
