import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Get API key from server-side environment (never exposed to client)
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_API_BASE = process.env.NEYNAR_API_BASE || "https://api.neynar.com";

if (!NEYNAR_API_KEY) {
  console.warn("Warning: NEYNAR_API_KEY not set. Neynar API calls will fail.");
}

// Proxy endpoint for user lookup by username
app.get("/api/farcaster/user/:username", async (req, res) => {
  if (!NEYNAR_API_KEY) {
    return res.status(500).json({ error: "Neynar API key not configured" });
  }

  try {
    const { username } = req.params;
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
});

// Proxy endpoint for batch profile resolution
app.post("/api/farcaster/profiles", async (req, res) => {
  if (!NEYNAR_API_KEY) {
    return res.status(500).json({ error: "Neynar API key not configured" });
  }

  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: "addresses must be an array" });
    }

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
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});

