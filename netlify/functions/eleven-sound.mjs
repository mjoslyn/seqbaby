import { elevenSound } from "../../lib/api.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }
  try {
    const body = JSON.parse(event.body || "{}");
    const out = await elevenSound(body);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err?.message ?? err) }),
    };
  }
};
