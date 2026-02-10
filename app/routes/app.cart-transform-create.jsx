import { authenticate } from "../shopify.server";

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
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
    return json(data, { status: 200 });
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
