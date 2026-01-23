import type { BeamrData, Pool, PoolMember, PoolDistributor, BeamrConfig } from "./superfluid";

const BEAMR_DATA_STORAGE_KEY = "beamr:data:v1";
const BEAMR_DATA_TIMESTAMP_KEY = "beamr:data:timestamp";
const BEAMR_DATA_CONFIG_KEY = "beamr:data:config";

type CachedBeamrData = {
  pools: Pool[];
  poolDistributions: never[];
  cachedAt: number;
  config?: BeamrConfig;
};

/**
 * Load cached BeamrData from localStorage
 * Returns null if cache is invalid or config doesn't match
 */
export function loadCachedBeamrData(currentConfig?: BeamrConfig): BeamrData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BEAMR_DATA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBeamrData;
    if (!parsed || !Array.isArray(parsed.pools)) return null;

    // If config is provided, verify it matches cached config
    if (currentConfig && parsed.config) {
      if (
        parsed.config.subgraphUrl !== currentConfig.subgraphUrl ||
        parsed.config.tokenAddress.toLowerCase() !== currentConfig.tokenAddress.toLowerCase()
      ) {
        // Config changed, cache is invalid
        return null;
      }
    }

    return {
      pools: parsed.pools,
      poolDistributions: [],
    };
  } catch {
    return null;
  }
}

/**
 * Save BeamrData to localStorage
 */
export function saveBeamrData(data: BeamrData, config?: BeamrConfig): void {
  if (typeof window === "undefined") return;
  try {
    const cached: CachedBeamrData = {
      pools: data.pools,
      poolDistributions: [],
      cachedAt: Date.now(),
      config,
    };
    window.localStorage.setItem(BEAMR_DATA_STORAGE_KEY, JSON.stringify(cached));
    window.localStorage.setItem(BEAMR_DATA_TIMESTAMP_KEY, Date.now().toString());
    if (config) {
      window.localStorage.setItem(BEAMR_DATA_CONFIG_KEY, JSON.stringify(config));
    }
  } catch (err) {
    console.warn("Failed to save BeamrData to localStorage:", err);
  }
}

/**
 * Get the timestamp of the last cached data
 */
export function getCachedDataTimestamp(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BEAMR_DATA_TIMESTAMP_KEY);
    if (!raw) return null;
    return Number.parseInt(raw, 10);
  } catch {
    return null;
  }
}

/**
 * Deep equality check for pool members
 */
function poolMembersEqual(a: PoolMember, b: PoolMember): boolean {
  return (
    a.id === b.id &&
    a.account.id.toLowerCase() === b.account.id.toLowerCase() &&
    a.units === b.units &&
    a.isConnected === b.isConnected
  );
}

/**
 * Deep equality check for pool distributors
 */
function poolDistributorsEqual(a: PoolDistributor, b: PoolDistributor): boolean {
  return (
    a.id === b.id &&
    a.account.id.toLowerCase() === b.account.id.toLowerCase() &&
    a.flowRate === b.flowRate
  );
}

/**
 * Deep equality check for pools
 */
function poolsEqual(a: Pool, b: Pool): boolean {
  if (a.id.toLowerCase() !== b.id.toLowerCase()) return false;
  if (a.admin?.toLowerCase() !== b.admin?.toLowerCase()) return false;
  if (a.totalUnits !== b.totalUnits) return false;
  if (a.flowRate !== b.flowRate) return false;
  if (a.perUnitFlowRate !== b.perUnitFlowRate) return false;

  // Check pool members
  const aMembers = (a.poolMembers ?? []).sort((x, y) => x.id.localeCompare(y.id));
  const bMembers = (b.poolMembers ?? []).sort((x, y) => x.id.localeCompare(y.id));
  if (aMembers.length !== bMembers.length) return false;
  for (let i = 0; i < aMembers.length; i++) {
    if (!poolMembersEqual(aMembers[i], bMembers[i])) return false;
  }

  // Check pool distributors
  const aDistributors = (a.poolDistributors ?? []).sort((x, y) => x.id.localeCompare(y.id));
  const bDistributors = (b.poolDistributors ?? []).sort((x, y) => x.id.localeCompare(y.id));
  if (aDistributors.length !== bDistributors.length) return false;
  for (let i = 0; i < aDistributors.length; i++) {
    if (!poolDistributorsEqual(aDistributors[i], bDistributors[i])) return false;
  }

  return true;
}

/**
 * Merge new BeamrData into existing BeamrData, applying diffs
 * This function:
 * - Adds new pools that don't exist
 * - Updates existing pools that have changed
 * - Keeps existing pools that haven't changed
 * - Never removes pools (only adds/updates)
 */
export function mergeBeamrData(existing: BeamrData, incoming: BeamrData): BeamrData {
  const existingPoolMap = new Map<string, Pool>();
  for (const pool of existing.pools) {
    existingPoolMap.set(pool.id.toLowerCase(), pool);
  }

  const mergedPools: Pool[] = [...existing.pools];

  for (const incomingPool of incoming.pools) {
    const poolId = incomingPool.id.toLowerCase();
    const existingPool = existingPoolMap.get(poolId);

    if (!existingPool) {
      // New pool - add it
      mergedPools.push(incomingPool);
    } else {
      // Existing pool - check if it changed
      if (!poolsEqual(existingPool, incomingPool)) {
        // Pool changed - update it
        const index = mergedPools.findIndex((p) => p.id.toLowerCase() === poolId);
        if (index >= 0) {
          mergedPools[index] = incomingPool;
        }
      }
      // If pool hasn't changed, keep the existing one
    }
  }

  return {
    pools: mergedPools,
    poolDistributions: [],
  };
}

/**
 * Check if there are any changes between two BeamrData objects
 */
export function hasBeamrDataChanges(existing: BeamrData, incoming: BeamrData): boolean {
  const existingPoolMap = new Map<string, Pool>();
  for (const pool of existing.pools) {
    existingPoolMap.set(pool.id.toLowerCase(), pool);
  }

  // Check if any incoming pool is new or changed
  for (const incomingPool of incoming.pools) {
    const poolId = incomingPool.id.toLowerCase();
    const existingPool = existingPoolMap.get(poolId);

    if (!existingPool) {
      // New pool found
      return true;
    }

    if (!poolsEqual(existingPool, incomingPool)) {
      // Changed pool found
      return true;
    }
  }

  return false;
}

