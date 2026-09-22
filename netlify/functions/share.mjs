import { putShare, getShare } from "../../lib/api.js";

export const handler = async (event) => {
  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const out = await putShare(body);
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(out) };
    }
    if (event.httpMethod === "GET") {
      const id = (event.queryStringParameters || {}).id;
      const { session, createdAt } = await getShare({ id });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        // title/ownerId ride along in the stored blob for getShareMeta's
        // sake; this endpoint hands back only what a caller asked for.
        body: JSON.stringify({ session, createdAt }),
      };
    }
    return { statusCode: 405, body: "method not allowed" };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err?.message ?? err) }),
    };
  }
};
