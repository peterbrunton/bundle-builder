use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use shopify_function::prelude::*;
use shopify_function::Result;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct BundleComponent {
    id: String,
    quantity: i32,
    role: String,
    unit_cents: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct RawBundleComponent {
    id: Option<String>,
    quantity: Option<i32>,
    role: Option<String>,
    #[serde(default, alias = "unitCents")]
    unit_cents: Option<i64>,
}

#[derive(Serialize)]
struct SignaturePayload<'a> {
    version: &'a str,
    bundle_id: &'a str,
    rulebook_id: &'a str,
    components: &'a [BundleComponent],
    discounted_cents: i64,
}

#[shopify_function_target(query_path = "src/cart_transform_run.graphql", schema_path = "schema.graphql")]
fn cart_transform_run(
    input: cart_transform_run::input::ResponseData,
) -> Result<cart_transform_run::output::CartTransformRunResult> {
    let mut operations: Vec<cart_transform_run::output::Operation> = Vec::new();
    let secret = input
        .cart_transform
        .metafield
        .as_ref()
        .map(|m| m.value.clone())
        .unwrap_or_default();

    for line in input.cart.lines {
        let raw_components = line
            .bundle_components
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_default();
        let components = match parse_components(&raw_components) {
            Some(parsed) if !parsed.is_empty() => parsed,
            _ => continue,
        };

        let line_quantity = line.quantity.max(1);
        let bundle_id = line
            .bundle_id
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_default();
        let bundle_rulebook = line
            .bundle_rulebook
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_default();
        let bundle_version = line
            .bundle_version
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_else(|| "v1".to_string());
        let signature_version = line
            .bundle_signature_version
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_else(|| "v2".to_string());
        let signature = line
            .bundle_signature
            .as_ref()
            .and_then(|attribute| attribute.value.as_ref())
            .cloned()
            .unwrap_or_default();
        let discounted_cents = non_negative_int(
            line.bundle_discounted_cents
                .as_ref()
                .and_then(|attribute| attribute.value.as_ref())
                .map(|value| value.as_str())
                .unwrap_or("0"),
        );
        let signature_valid = verify_signature(
            &secret,
            &signature,
            &signature_version,
            &bundle_id,
            &bundle_rulebook,
            &components,
            discounted_cents,
        );

        let base_totals: Vec<i64> = components
            .iter()
            .map(|component| {
                let component_qty = i64::from(component.quantity.max(1));
                component.unit_cents.max(0) * component_qty * line_quantity
            })
            .collect();
        let expanded_quantities: Vec<i64> = components
            .iter()
            .map(|component| i64::from(component.quantity.max(1)) * line_quantity)
            .collect();
        let target_total_cents = discounted_cents.max(0) * line_quantity;
        let allocated_totals = if signature_valid {
            allocate_component_totals(&base_totals, target_total_cents)
        } else {
            None
        };

        let mut expanded_items: Vec<cart_transform_run::output::ExpandedItem> = Vec::new();
        for (index, component) in components.iter().enumerate() {
            let quantity = expanded_quantities[index];
            let price = allocated_totals
                .as_ref()
                .and_then(|totals| totals.get(index).copied())
                .and_then(|total_cents| {
                    if quantity <= 0 {
                        return None;
                    }
                    let amount = round_to_cents((total_cents as f64) / (quantity as f64) / 100.0);
                    Some(cart_transform_run::output::ExpandedItemPriceAdjustment {
                        adjustment:
                            cart_transform_run::output::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
                                cart_transform_run::output::ExpandedItemFixedPricePerUnitAdjustment {
                                    amount: Decimal(amount),
                                },
                            ),
                    })
                });
            expanded_items.push(cart_transform_run::output::ExpandedItem {
                merchandise_id: normalize_gid(&component.id),
                quantity,
                attributes: Some(vec![
                    cart_transform_run::output::AttributeOutput {
                        key: "_bundle_id".to_string(),
                        value: bundle_id.clone(),
                    },
                    cart_transform_run::output::AttributeOutput {
                        key: "_bundle_role".to_string(),
                        value: component.role.clone(),
                    },
                    cart_transform_run::output::AttributeOutput {
                        key: "_bundle_version".to_string(),
                        value: bundle_version.clone(),
                    },
                ]),
                price,
            });
        }

        if expanded_items.is_empty() {
            continue;
        }

        operations.push(cart_transform_run::output::Operation::LineExpand(
            cart_transform_run::output::LineExpandOperation {
                cart_line_id: line.id.clone(),
                expanded_cart_items: expanded_items,
                image: None,
                price: None,
                title: None,
            },
        ));
    }

    Ok(cart_transform_run::output::CartTransformRunResult { operations })
}

fn parse_components(raw: &str) -> Option<Vec<BundleComponent>> {
    let parsed: Vec<RawBundleComponent> = serde_json::from_str(raw).ok()?;
    let mut normalized: Vec<BundleComponent> = parsed
        .into_iter()
        .filter_map(|component| {
            let id = normalize_gid(component.id?.as_str());
            if id.is_empty() {
                return None;
            }
            let quantity = component.quantity.unwrap_or(1).max(1);
            Some(BundleComponent {
                id,
                quantity,
                role: component.role.unwrap_or_else(|| "component".to_string()),
                unit_cents: component.unit_cents.unwrap_or(0).max(0),
            })
        })
        .collect();

    normalized.sort_by(|a, b| {
        let role_cmp = a.role.cmp(&b.role);
        if role_cmp != std::cmp::Ordering::Equal {
            return role_cmp;
        }
        let id_cmp = a.id.cmp(&b.id);
        if id_cmp != std::cmp::Ordering::Equal {
            return id_cmp;
        }
        a.quantity.cmp(&b.quantity)
    });

    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn normalize_gid(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return String::new();
    }
    if value.starts_with("gid://shopify/ProductVariant/") {
        return value.to_string();
    }
    format!("gid://shopify/ProductVariant/{value}")
}

fn non_negative_int(raw: &str) -> i64 {
    raw.parse::<i64>().unwrap_or(0).max(0)
}

fn round_to_cents(amount: f64) -> f64 {
    (amount * 100.0).round() / 100.0
}

fn allocate_component_totals(base_totals: &[i64], target_total_cents: i64) -> Option<Vec<i64>> {
    if base_totals.is_empty() || target_total_cents < 0 {
        return None;
    }
    let total_base: i64 = base_totals.iter().copied().sum();
    if total_base <= 0 {
        return None;
    }

    let mut allocations: Vec<i64> = Vec::with_capacity(base_totals.len());
    let mut remainders: Vec<(usize, i64)> = Vec::with_capacity(base_totals.len());
    let mut allocated_sum: i64 = 0;

    for (index, base) in base_totals.iter().copied().enumerate() {
        let numerator = base.saturating_mul(target_total_cents);
        let floor = numerator / total_base;
        let remainder = numerator % total_base;
        allocations.push(floor);
        remainders.push((index, remainder));
        allocated_sum += floor;
    }

    let mut pennies_left = target_total_cents - allocated_sum;
    remainders.sort_by(|a, b| b.1.cmp(&a.1));
    let mut cursor = 0usize;
    while pennies_left > 0 && !remainders.is_empty() {
        let index = remainders[cursor].0;
        allocations[index] += 1;
        pennies_left -= 1;
        cursor = (cursor + 1) % remainders.len();
    }

    Some(allocations)
}

fn build_signature_payload(
    signature_version: &str,
    bundle_id: &str,
    rulebook_id: &str,
    components: &[BundleComponent],
    discounted_cents: i64,
) -> String {
    let payload = SignaturePayload {
        version: signature_version,
        bundle_id,
        rulebook_id,
        components,
        discounted_cents: discounted_cents.max(0),
    };
    serde_json::to_string(&payload).unwrap_or_default()
}

fn sign_payload(secret: &str, payload: &str) -> Option<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    Some(hex::encode(mac.finalize().into_bytes()))
}

fn verify_signature(
    secret: &str,
    signature: &str,
    signature_version: &str,
    bundle_id: &str,
    rulebook_id: &str,
    components: &[BundleComponent],
    discounted_cents: i64,
) -> bool {
    if secret.is_empty() || signature.is_empty() {
        return false;
    }
    let payload = build_signature_payload(
        signature_version,
        bundle_id,
        rulebook_id,
        components,
        discounted_cents,
    );
    match sign_payload(secret, &payload) {
        Some(expected) => expected.eq_ignore_ascii_case(signature),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_payload_signing_and_verification_work() {
        let components = vec![
            BundleComponent {
                id: "gid://shopify/ProductVariant/2".to_string(),
                quantity: 1,
                role: "small".to_string(),
                unit_cents: 1000,
            },
            BundleComponent {
                id: "gid://shopify/ProductVariant/1".to_string(),
                quantity: 2,
                role: "full".to_string(),
                unit_cents: 5000,
            },
        ];
        let payload = build_signature_payload("v2", "bundle_1", "bundle-config-1", &components, 1234);
        let secret = "top-secret";
        let signature = sign_payload(secret, &payload).expect("signature");
        assert!(verify_signature(
            secret,
            &signature,
            "v2",
            "bundle_1",
            "bundle-config-1",
            &components,
            1234,
        ));
    }

    #[test]
    fn tampered_discount_fails_validation() {
        let components = vec![BundleComponent {
            id: "gid://shopify/ProductVariant/1".to_string(),
            quantity: 1,
            role: "full".to_string(),
            unit_cents: 5000,
        }];
        let payload = build_signature_payload("v2", "bundle_1", "bundle-config-1", &components, 1000);
        let secret = "top-secret";
        let signature = sign_payload(secret, &payload).expect("signature");
        assert!(!verify_signature(
            secret,
            &signature,
            "v2",
            "bundle_1",
            "bundle-config-1",
            &components,
            999,
        ));
    }
}
