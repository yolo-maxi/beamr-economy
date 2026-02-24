type NeynarUser = {
  username?: string;
  fname?: string;
  display_name?: string;
  displayName?: string;
  pfp_url?: string;
  pfpUrl?: string;
  custody_address?: string;
  verified_addresses?: { eth_addresses?: string[] };
};

type NeynarBulkEntry = {
  address?: string;
  user?: NeynarUser;
};

const DEFAULT_NEYNAR_API_BASE = "https://api.neynar.com"; //https://api.neynar.com/v2/farcaster/user/bulk-by-address/
const DEFAULT_BATCH_SIZE = 100;
const FARCASTER_CACHE_KEY = "beamr:farcasterProfiles:v1";
const FARCASTER_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type CachedProfiles = {
  updatedAt: number;
  profiles: Record<string, { username?: string; avatarUrl?: string }>;
};

function readUserName(user?: NeynarUser | null) {
  return (
    user?.username ??
    user?.fname ??
    user?.display_name ??
    user?.displayName ??
    null
  );
}

function readAvatarUrl(user?: NeynarUser | null) {
  return user?.pfp_url ?? user?.pfpUrl ?? null;
}

function collectUserAddresses(user?: NeynarUser | null) {
  const addresses = new Set<string>();
  if (user?.custody_address) addresses.add(user.custody_address.toLowerCase());
  for (const address of user?.verified_addresses?.eth_addresses ?? []) {
    addresses.add(address.toLowerCase());
  }
  return Array.from(addresses);
}

function extractUserFromValue(value: unknown): NeynarUser | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("user" in value && (value as { user?: NeynarUser }).user) {
    return (value as { user?: NeynarUser }).user;
  }
  if ("users" in value) {
    const users = (value as { users?: NeynarUser[] }).users;
    if (Array.isArray(users) && users.length) {
      return users[0];
    }
  }
  if (Array.isArray(value)) {
    const [first] = value as NeynarUser[];
    return first;
  }
  return value as NeynarUser;
}

function normalizePayloadEntries(payload: unknown): NeynarBulkEntry[] {
  if (!payload || typeof payload !== "object") return [];

  // The API returns { "0xaddress": [user, ...], ... } directly at the top level
  // Check if this looks like an address-keyed map (keys start with 0x)
  const keys = Object.keys(payload);
  const looksLikeAddressMap =
    keys.length > 0 && keys.every((k) => k.startsWith("0x"));

  if (looksLikeAddressMap) {
    return Object.entries(payload as Record<string, unknown>).map(
      ([address, value]) => {
        const user = extractUserFromValue(value);
        return { address, user };
      }
    );
  }

  // Legacy format support
  const data = payload as {
    result?: {
      users?: NeynarUser[];
      users_by_address?: NeynarBulkEntry[] | Record<string, unknown>;
    };
    users?: NeynarUser[];
    users_by_address?: NeynarBulkEntry[] | Record<string, unknown>;
  };
  const raw =
    data.result?.users_by_address ??
    data.users_by_address ??
    data.result?.users ??
    data.users;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw as NeynarBulkEntry[];
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([address, value]) => {
      const user = extractUserFromValue(value);
      return { address, user };
    });
  }

  return [];
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function readProfileCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FARCASTER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfiles;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.updatedAt || !parsed.profiles) return null;
    if (Date.now() - parsed.updatedAt > FARCASTER_CACHE_TTL_MS) return null;
    return parsed.profiles;
  } catch {
    return null;
  }
}

function writeProfileCache(
  profiles: Record<string, { username?: string; avatarUrl?: string }>
) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedProfiles = {
      updatedAt: Date.now(),
      profiles,
    };
    window.localStorage.setItem(FARCASTER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

async function fetchSingleProfile(
  address: string,
  apiKey: string,
  base: string
) {
  const response = await fetch(
    `${base}/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(address)}`,
    {
      headers: {
        accept: "application/json",
        api_key: apiKey,
        "x-api-key": apiKey,
      },
    }
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  const entries = normalizePayloadEntries(payload);
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.address && entry.user) {
      const username = readUserName(entry.user);
      const avatarUrl = readAvatarUrl(entry.user);
      if (username || avatarUrl) {
        return {
          address: entry.address.toLowerCase(),
          profile: { username: username ?? undefined, avatarUrl: avatarUrl ?? undefined },
        };
      }
      continue;
    }
    const user = (entry as NeynarUser) ?? entry.user;
    const username = readUserName(user);
    const avatarUrl = readAvatarUrl(user);
    if (!username && !avatarUrl) continue;
    return {
      address: address.toLowerCase(),
      profile: { username: username ?? undefined, avatarUrl: avatarUrl ?? undefined },
    };
  }
  return null;
}

export async function fetchUserByUsername(username: string): Promise<{
  username: string;
  displayName?: string;
  avatarUrl?: string;
} | null> {
  // Use backend proxy if available (Vercel API routes or custom proxy)
  // On Vercel, API routes are at /api/*, so we use relative paths
  // For local dev with Express server, use VITE_API_BASE_URL
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiUrl = apiBase 
    ? `${apiBase}/api/farcaster/user/${encodeURIComponent(username)}`
    : `/api/farcaster/user/${encodeURIComponent(username)}`;
  
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const payload = (await response.json()) as { user?: NeynarUser };
      const user = payload.user;
      if (!user) return null;
      return {
        username: readUserName(user) ?? username,
        displayName: user.display_name ?? user.displayName,
        avatarUrl: readAvatarUrl(user) ?? undefined,
      };
    }
    // Proxy not available — fall through to direct API
    throw new Error("API proxy not available");
  } catch (error) {
    // Fall through to direct API if proxy fails
  }

  // Fallback to direct API (not recommended - exposes API key)
  const apiKey = import.meta.env.VITE_NEYNAR_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn("No API key or proxy configured. Set VITE_API_BASE_URL or VITE_NEYNAR_API_KEY");
    return null;
  }

  const base =
    (import.meta.env.VITE_NEYNAR_API_BASE as string | undefined) ??
    DEFAULT_NEYNAR_API_BASE;

  try {
    const response = await fetch(
      `${base}/v2/farcaster/user/by_username?username=${encodeURIComponent(username)}`,
      {
        headers: {
          accept: "application/json",
          api_key: apiKey,
          "x-api-key": apiKey,
        },
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: NeynarUser };
    const user = payload.user;
    if (!user) return null;
    return {
      username: readUserName(user) ?? username,
      displayName: user.display_name ?? user.displayName,
      avatarUrl: readAvatarUrl(user) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function resolveNeynarProfiles(addresses: string[]) {
  const unique = Array.from(
    new Set(addresses.map((address) => address.toLowerCase()))
  );
  if (!unique.length) return {};

  const cache = readProfileCache() ?? {};
  const mapping: Record<string, { username?: string; avatarUrl?: string }> = {
    ...cache,
  };

  const remaining = unique.filter((address) => !mapping[address]);
  if (!remaining.length) return mapping;

  // Use backend proxy if available (Vercel API routes or custom proxy)
  // On Vercel, API routes are at /api/*, so we use relative paths
  // For local dev with Express server, use VITE_API_BASE_URL
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiUrl = apiBase 
    ? `${apiBase}/api/farcaster/profiles`
    : `/api/farcaster/profiles`;
  
  try {
    const batchSize = Number(
      import.meta.env.VITE_NEYNAR_BATCH_SIZE ?? DEFAULT_BATCH_SIZE
    );
    const batches = chunk(remaining, Number.isFinite(batchSize) ? batchSize : 100);

    const results = await Promise.all(
      batches.map(async (batch) => {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ addresses: batch }),
        });
        if (!response.ok) {
          // Proxy not available — throw to fall through to direct API
          throw new Error("API proxy not available");
        }
        const payload = (await response.json()) as unknown;
        return normalizePayloadEntries(payload);
      })
    );

      for (const entries of results) {
        for (const entry of entries) {
          if (!entry) continue;
          if (entry.address && entry.user) {
            const username = readUserName(entry.user);
            const avatarUrl = readAvatarUrl(entry.user);
            if (username || avatarUrl) {
              mapping[entry.address.toLowerCase()] = {
                username: username ?? undefined,
                avatarUrl: avatarUrl ?? undefined,
              };
            }
            continue;
          }
          const user = (entry as NeynarUser) ?? entry.user;
          const username = readUserName(user);
          const avatarUrl = readAvatarUrl(user);
          if (!username && !avatarUrl) continue;
          for (const address of collectUserAddresses(user)) {
            mapping[address] = {
              username: username ?? undefined,
              avatarUrl: avatarUrl ?? undefined,
            };
          }
        }
      }

    writeProfileCache(mapping);
    return mapping;
  } catch (error) {
    // Fall through to direct API fallback if proxy fails or not configured
  }

  // Fallback to direct API (not recommended - exposes API key)
  const apiKey = import.meta.env.VITE_NEYNAR_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn("No API key or proxy configured. Set VITE_API_BASE_URL or VITE_NEYNAR_API_KEY");
    return mapping; // Return cached results only
  }

  const base =
    (import.meta.env.VITE_NEYNAR_API_BASE as string | undefined) ??
    DEFAULT_NEYNAR_API_BASE;
  const batchSize = Number(
    import.meta.env.VITE_NEYNAR_BATCH_SIZE ?? DEFAULT_BATCH_SIZE
  );
  const batches = chunk(remaining, Number.isFinite(batchSize) ? batchSize : 100);

  const results = await Promise.all(
    batches.map(async (batch) => {
      const query = encodeURIComponent(batch.join(","));
      const response = await fetch(
        `${base}/v2/farcaster/user/bulk-by-address?addresses=${query}`,
        {
          headers: {
            accept: "application/json",
            api_key: apiKey,
            "x-api-key": apiKey,
          },
        }
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as unknown;
      return normalizePayloadEntries(payload);
    })
  );

  for (const entries of results) {
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.address && entry.user) {
        const username = readUserName(entry.user);
        const avatarUrl = readAvatarUrl(entry.user);
        if (username || avatarUrl) {
          mapping[entry.address.toLowerCase()] = {
            username: username ?? undefined,
            avatarUrl: avatarUrl ?? undefined,
          };
        }
        continue;
      }
      const user = (entry as NeynarUser) ?? entry.user;
      const username = readUserName(user);
      const avatarUrl = readAvatarUrl(user);
      if (!username && !avatarUrl) continue;
      for (const address of collectUserAddresses(user)) {
        mapping[address] = {
          username: username ?? undefined,
          avatarUrl: avatarUrl ?? undefined,
        };
      }
    }
  }

  const stillMissing = remaining.filter((address) => !mapping[address]);
  if (stillMissing.length) {
    for (const address of stillMissing) {
      try {
        const result = await fetchSingleProfile(address, apiKey, base);
        if (result?.profile) {
          mapping[result.address] = result.profile;
        }
      } catch {
        // ignore per-address failures
      }
    }
  }

  writeProfileCache(mapping);

  return mapping;
}

