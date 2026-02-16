# Bundle Signature Contract (v2)

The bundle signature payload is now canonicalized before HMAC signing.

## Version

- `v2`

## Canonical Payload Shape

```json
{
  "version": "v2",
  "bundle_id": "bundle_...",
  "rulebook_id": "bundle-config-1",
  "components": [
    {
      "id": "gid://shopify/ProductVariant/123",
      "quantity": 1,
      "role": "full"
    }
  ],
  "discounted_cents": 1234
}
```

## Canonicalization Rules

1. Component IDs are always normalized to `gid://shopify/ProductVariant/<id>`.
2. `quantity` is coerced to a positive integer with a minimum of `1`.
3. `role` is string-coerced.
4. Components are sorted by `role`, then `id`, then `quantity`.
5. `discounted_cents` is coerced to a non-negative integer.

## Stored Cart Attributes

- `_bundle_signature`
- `_bundle_signature_version` (currently `v2`)

## Verification Runtime

- Verification now runs in the Rust cart transform at `extensions/bundle-cart-transform/src/lib.rs`.
- The legacy JavaScript implementation is preserved at `extensions/bundle-cart-transform/src/cart_transform_run.legacy.js`.
