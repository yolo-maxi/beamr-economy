export type PoolDistribution = {
  id: string;
  pool: { id: string };
  distributor: { id: string };
  flowRate: string;
  createdAtTimestamp?: string;
  updatedAtTimestamp?: string;
};

export type PoolMember = {
  id: string;
  account: { id: string };
  units: string;
  isConnected?: boolean;
};

export type PoolDistributor = {
  id: string;
  flowRate: string;
  account: { id: string };
};

export type Pool = {
  id: string;
  admin?: string;
  totalUnits?: string;
  poolMembers: PoolMember[];
  poolDistributors?: PoolDistributor[];
  flowRate?: string;
  perUnitFlowRate?: string;
};

export type BeamrData = {
  pools: Pool[];
  poolDistributions: PoolDistribution[];
};

export type BeamrConfig = {
  subgraphUrl: string;
  tokenAddress: string;
};

const DEFAULT_BEAMR_ADDRESS = "0x22f1cd353441351911691EE4049c7b773abb1ecF";
const STORAGE_KEY = "beamr-viz-config";

const POOLS_AND_DISTRIBUTIONS_QUERY = `
  query BeamrPoolsAndDistributions($token: String!) {
    pools(where: { token: $token, perUnitFlowRate_gt: "0" }) {
      id
      admin
      totalUnits
      flowRate
      perUnitFlowRate
      poolDistributors {
        id
        flowRate
        account {
          id
        }
      }
      poolMembers {
        id
        units
        isConnected
        account {
          id
        }
      }
    }
  }
`;

type GraphResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

async function fetchGraph<T>(
  subgraphUrl: string,
  query: string,
  tokenAddress: string
): Promise<T> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { token: tokenAddress.toLowerCase() },
    }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed: ${response.status}`);
  }

  const payload = (await response.json()) as GraphResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((err) => err.message).join(", "));
  }

  if (!payload.data) {
    throw new Error("Subgraph returned no data.");
  }

  return payload.data;
}

function readStoredConfig(): Partial<BeamrConfig> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<BeamrConfig>;
  } catch {
    return {};
  }
}

export function readBeamrConfig(): BeamrConfig {
  const stored = readStoredConfig();
  const envSubgraph = import.meta.env.VITE_SUPERFLUID_SUBGRAPH_URL as
    | string
    | undefined;
  const envToken = import.meta.env.VITE_BEAMR_TOKEN_ADDRESS as
    | string
    | undefined;
  return {
    subgraphUrl: stored.subgraphUrl ?? envSubgraph ?? "",
    tokenAddress: stored.tokenAddress ?? envToken ?? DEFAULT_BEAMR_ADDRESS,
  };
}

export function saveBeamrConfig(config: BeamrConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function resolveBeamrConfig(overrides?: Partial<BeamrConfig>): BeamrConfig {
  const base = readBeamrConfig();
  return {
    subgraphUrl: overrides?.subgraphUrl ?? base.subgraphUrl,
    tokenAddress: overrides?.tokenAddress ?? base.tokenAddress,
  };
}

export async function fetchBeamrData(
  overrides?: Partial<BeamrConfig>
): Promise<BeamrData> {
  const { subgraphUrl, tokenAddress } = resolveBeamrConfig(overrides);
  if (!subgraphUrl) {
    throw new Error(
      "Missing subgraph URL. Set VITE_SUPERFLUID_SUBGRAPH_URL or add it in settings."
    );
  }

  const payload = await fetchGraph<{
    pools: Pool[];
  }>(subgraphUrl, POOLS_AND_DISTRIBUTIONS_QUERY, tokenAddress);
  return {
    pools: payload.pools ?? [],
    poolDistributions: [],
  };
}

