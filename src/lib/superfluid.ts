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
  account: { id: string; balance?: string; updatedAtTimestamp?: string };
  units: string;
  isConnected?: boolean;
};

export type PoolDistributor = {
  id: string;
  flowRate: string;
  account: { id: string; balance?: string; updatedAtTimestamp?: string };
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
const DEFAULT_SUBGRAPH_URL = "https://subgraph-endpoints.superfluid.dev/base-mainnet/protocol-v1";

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
          updatedAtTimestamp
          accountTokenSnapshots(where: { token: $token }) {
            balanceUntilUpdatedAt
          }
        }
      }
      poolMembers {
        id
        units
        isConnected
        account {
          id
          updatedAtTimestamp
          accountTokenSnapshots(where: { token: $token }) {
            balanceUntilUpdatedAt
          }
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

export function readBeamrConfig(): BeamrConfig {
  return {
    subgraphUrl: DEFAULT_SUBGRAPH_URL,
    tokenAddress: DEFAULT_BEAMR_ADDRESS,
  };
}

function resolveBeamrConfig(overrides?: Partial<BeamrConfig>): BeamrConfig {
  const base = readBeamrConfig();
  return {
    subgraphUrl: overrides?.subgraphUrl ?? base.subgraphUrl,
    tokenAddress: overrides?.tokenAddress ?? base.tokenAddress,
  };
}

function extractBalance(accountTokenSnapshots?: { balanceUntilUpdatedAt: string }[]): string | undefined {
  if (!accountTokenSnapshots || accountTokenSnapshots.length === 0) return undefined;
  return accountTokenSnapshots[0].balanceUntilUpdatedAt;
}

type GraphQLPoolDistributor = {
  id: string;
  flowRate: string;
  account: {
    id: string;
    updatedAtTimestamp?: string;
    accountTokenSnapshots?: { balanceUntilUpdatedAt: string }[]
  };
};

type GraphQLPoolMember = {
  id: string;
  units: string;
  isConnected?: boolean;
  account: {
    id: string;
    updatedAtTimestamp?: string;
    accountTokenSnapshots?: { balanceUntilUpdatedAt: string }[]
  };
};

type GraphQLPool = Omit<Pool, 'poolDistributors' | 'poolMembers'> & {
  poolDistributors?: GraphQLPoolDistributor[];
  poolMembers: GraphQLPoolMember[];
};

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
    pools: GraphQLPool[];
  }>(subgraphUrl, POOLS_AND_DISTRIBUTIONS_QUERY, tokenAddress);

  // Process pools to extract balance from accountTokenSnapshots
  const pools: Pool[] = payload.pools.map(pool => ({
    ...pool,
    poolDistributors: pool.poolDistributors?.map(dist => ({
      id: dist.id,
      flowRate: dist.flowRate,
      account: {
        id: dist.account.id,
        balance: extractBalance(dist.account.accountTokenSnapshots),
        updatedAtTimestamp: dist.account.updatedAtTimestamp
      }
    })),
    poolMembers: pool.poolMembers.map(member => ({
      id: member.id,
      units: member.units,
      isConnected: member.isConnected,
      account: {
        id: member.account.id,
        balance: extractBalance(member.account.accountTokenSnapshots),
        updatedAtTimestamp: member.account.updatedAtTimestamp
      }
    }))
  }));

  return {
    pools,
    poolDistributions: [],
  };
}

