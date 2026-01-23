import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username } = req.query;
  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "Username is required" });
  }

  const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
  const NEYNAR_API_BASE = process.env.NEYNAR_API_BASE || "https://api.neynar.com";

  if (!NEYNAR_API_KEY) {
    return res.status(500).json({ error: "Neynar API key not configured" });
  }

  try {
    const response = await fetch(
      `${NEYNAR_API_BASE}/v2/farcaster/user/by_username?username=${encodeURIComponent(username)}`,
      {
        headers: {
          accept: "application/json",
          api_key: NEYNAR_API_KEY,
          "x-api-key": NEYNAR_API_KEY,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "User not found" });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

