import { authenticate } from "../shopify.server";

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
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
      return json({ ok: false, error: "Shop ID not found" }, { status: 500 });
    }

    const existingResponse = await admin.graphql(
      `#graphql
      query ExistingCartTransforms {
        cartTransforms(first: 10) {
          nodes {
            id
            functionId
          }
        }
      }`,
    );
    const existingData = await existingResponse.json();
    const existingTransforms = existingData?.data?.cartTransforms?.nodes || [];
    if (existingTransforms.length > 0) {
      return json(
        {
          ok: false,
          skipped: true,
          reason: "cart_transform_exists",
          cartTransform: existingTransforms[0],
          cartTransforms: existingTransforms,
          message:
            "A cart transform already exists for this store. Remove it first if you want to create a new one.",
        },
        { status: 200 },
      );
    }

    const response = await admin.graphql(
      `#graphql
      mutation CreateCartTransform($functionHandle: String!) {
        cartTransformCreate(functionHandle: $functionHandle) {
          cartTransform {
            id
            functionId
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { functionHandle: "bundle-cart-transform" } },
    );
    const data = await response.json();
    const userErrors = data?.data?.cartTransformCreate?.userErrors || [];
    const createdTransform = data?.data?.cartTransformCreate?.cartTransform;
    if (userErrors.length === 0 && createdTransform?.id) {
      await admin.graphql(
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
                value: String(createdTransform.id),
              },
              {
                namespace: "bundle_builder",
                key: "cart_transform_function_id",
                ownerId: shopId,
                type: "single_line_text_field",
                value: String(createdTransform.functionId || ""),
              },
            ],
          },
        },
      );
    }
    return json(
      {
        ok: userErrors.length === 0,
        ...data,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cart-transform-create] error", error);
    return json(
      { error: "cartTransformCreate failed", detail: String(error?.message || error) },
      { status: 500 },
    );
  }
};

export const loader = async () =>
  json({ error: "Method not allowed" }, { status: 405 });
