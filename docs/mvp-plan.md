# Build Your Own Bundle — MVP Plan

**Objective**
Launch a Build Your Own Bundle feature with a guided builder. Customers select multiple items and receive a tiered discount based on bundle composition. Items are normal SKUs grouped in cart.

**One-Sentence Summary**
We are launching a guided bundle builder that groups real products together and applies a single tiered discount without creating new SKUs or altering operational workflows.

---

**Assumptions (to unblock MVP delivery)**
- Bundle builder with tiered discounts based on item counts.
- Two product groups: full-size and secondary/small.
- Bundle discount applies only to items added via the bundle builder.

**Locked Decisions**
- One Shopify app with a Theme App Extension (app block).
- Products remain normal SKUs.
- Bundle items are grouped visually in cart.
- Discounts apply only to bundle items.
- Multiple bundles allowed in the same cart.
- Tier-based pricing engine.
- One discount strategy per tier. No stacking inside a tier.

**MVP Decisions**
- Discount code stacking: allow order + shipping + product discounts.
- Product classification: metafields.
- Cart grouping UI: theme app block + JS.
- Cart Transform Function used to group/structure bundle lines.

**Important Caveat**
When product discounts combine, Shopify applies only the best product discount per line. This can cause a bundle line to take a different product discount if it is more favorable than the bundle discount. We will message this in QA and ensure it is acceptable for MVP.

---

**Bundle Structure**
- Products classified via metafields: `bundle_type = full | small | none`.
- Bundle line markers added at add-to-cart:
  - `bundle_id`
  - `bundle_role` (full | small)
  - `bundle_version` ("v1")

**Selection Rules (MVP)**
- Full-size items: min 1, max 2.
- Small items: min 0, max 4.
- Rules enforced client-side and server-side.

**Pricing Model**
- One tier per bundle.
- Example tiers:
  - 1 full + 2 small → 10% off bundle items
  - 1 full + 4 small → 15% off bundle items
  - 2 full + 4 small → 20% off bundle items
- Discounts do not stack within a tier.
- Marketing language like “Save €15” is display-only.

---

**Top 10 Mistakes to Avoid (Hard Requirements)**
- Only bundle-marked lines (`bundle_id`) are discounted.
- Staged selection. No cart writes until “Add bundle to cart.”
- `bundle_version` is always set.
- One tier → one discount rule.
- Discount Function is source of truth. UI savings are estimates only.
- Evaluate discounts per `bundle_id`, never across bundles.
- Cart edits drop discount if invalid. No auto-repair in MVP.
- Tiers are hardcoded for MVP.
- Cart Transform is optional, not required for MVP.
- Discount code behavior is decided and documented early.

---

**Development Phases**

**Phase 1 — App Skeleton + Extension Scaffolding**
Output: deployable app shell.
- Scaffold Shopify app with Theme App Extension (app block).
- Create two Shopify Functions:
  - Discount Function (tier discounts)
  - Cart Transform Function (group/structure bundle lines)

Acceptance criteria:
- App installs cleanly on dev store.
- Theme app block renders a placeholder.
- Discount Function runs and returns no discounts by default.
- Cart Transform Function runs and returns no changes by default.

**Phase 2 — Admin Configuration**
Output: merchants can control eligibility without code changes.
- Products are configured in Shopify admin via metafields.

Acceptance criteria:
- Eligibility is not based on collections or titles.
- Builder UI can query classification reliably.

**Phase 3 — Bundle Builder UI**
Output: customers can build valid bundles.
- Step-based interface in the app block.
- Enforce selection rules (1–2 full, 0–4 small).
- Queue + commit pattern.
- Add bundle items with shared `bundle_id`.
- Attach line item properties:
  - `bundle_id`
  - `bundle_role`
  - `bundle_version`

Acceptance criteria:
- No cart writes until commit.
- Valid bundle adds all items at once.
- Each line has bundle markers.

**Phase 4 — Discount Function**
Output: pricing behaves correctly.
- Find bundle-marked items.
- Count items per role and evaluate tier.
- Apply discount to qualifying items only.

Acceptance criteria:
- Non-bundle lines never discounted.
- Multiple bundles do not interfere.
- Invalid bundle = no discount.

**Phase 5 — Cart Transform Function**
Output: bundle lines are grouped in cart.
- Group items by `bundle_id` so the cart appears as a single bundle group.

Acceptance criteria:
- Bundle items are visually grouped.
- Removing items recalculates eligibility and can drop discount.

**Phase 6 — QA**
Output: production-safe behavior.
- Test critical scenarios.
- Add basic diagnostics for tier decision points.

Acceptance criteria:
- Valid bundle → discount applies.
- Mixed cart → only bundle lines discounted.
- Multiple bundles.
- Quantity edits.
- Item removal.
- Out-of-stock transitions.

---

**Discount Code Policy (MVP)**
- Bundle discounts can combine with order, shipping, and product discounts.
- If a bundle line has multiple product discounts available, Shopify applies the best product discount per line.

---

**Planned Milestone 2**
- Admin tier editor.
- Metaobject-based bundle configs.
- Merchandising controls.
- Cart editing.
- Enhanced savings display.
- Recommendation engine.

---

**QA Test Matrix (MVP)**
- Valid bundle qualifies and discounts apply.
- Mixed cart (bundle + non-bundle) only discounts bundle lines.
- Two bundles in same cart remain isolated.
- Removing a bundle line causes discount to drop.
- Quantity changes cause discount to drop if invalid.
- Applying a discount code still allows bundle discount to apply if the bundle discount is best product discount per line.
- Out-of-stock item removed does not break cart, discount recalculates.
