import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { addresses } = req.body;
  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: "addresses must be an array" });
  }

  const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
  const NEYNAR_API_BASE = process.env.NEYNAR_API_BASE || "https://api.neynar.com";

  if (!NEYNAR_API_KEY) {
    return res.status(500).json({ error: "Neynar API key not configured" });
  }

  try {
    // Neynar batch endpoint - uses query parameter format
    const query = encodeURIComponent(addresses.join(","));
    const response = await fetch(
      `${NEYNAR_API_BASE}/v2/farcaster/user/bulk-by-address?addresses=${query}`,
      {
        headers: {
          accept: "application/json",
          api_key: NEYNAR_API_KEY,
          "x-api-key": NEYNAR_API_KEY,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch profiles" });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

