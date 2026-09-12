// 스크립트 공용: Cloudflare bge-m3 임베딩
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

function l2(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export async function embed(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/baai/bge-m3`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [clean] }),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare AI ${res.status}`);
  const json = await res.json();
  const vec = json?.result?.data?.[0];
  if (!Array.isArray(vec)) throw new Error("형식 오류");
  return l2(vec);
}
