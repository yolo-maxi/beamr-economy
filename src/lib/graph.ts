import type { Edge, Node } from "reactflow";
import type { BeamrData, Pool } from "./superfluid";
import { resolveNeynarProfiles } from "./farcaster";
import {
  flowRateToStrokeWidth,
  formatFlowRate,
  normalizeAddress,
  shortenAddress,
  loadNodePositions,
  generateRandomPosition,
} from "./utils";

type GraphElements = {
  nodes: Node[];
  edges: Edge[];
};

type PoolInfo = {
  address: string;
  totalUnits?: string;
  flowRate?: string;
  flowRateLabel?: string;
  perUnitFlowRateLabel?: string;
  memberCount?: number;
};

type FlowStats = {
  totalFlowRate: bigint;
  userCount: number;
};

type UserNodeData = {
  address: string;
  label: string;
  farcaster?: string;
  avatarUrl?: string;
  kind: "user";
  distributedPools?: PoolInfo[];
  /** Aggregated incoming flow stats (receiving from others) */
  incomingFlows?: FlowStats;
  /** Aggregated outgoing flow stats (sending to others) */
  outgoingFlows?: FlowStats;
};

const DEFAULT_DECIMALS = 18;

const makeAccountNodeId = (address: string) => `account:${address}`;
const DEFAULT_FARCASTER_TIMEOUT_MS = 4000;
// Node visual sizes: distributors ~320px wide, regular ~200px wide
// Collision radius should be at least half the node width plus margin
const COLLIDE_RADIUS_BASE = 140;
const COLLIDE_RADIUS_DISTRIBUTOR = 220;
const LINK_DISTANCE = 500;
const CHARGE_STRENGTH = -2500;
const CHARGE_DISTANCE_MAX = 8000;
const CENTERING_STRENGTH = 0.01;
const MAX_RADIUS = 15000;
const SIMULATION_TICKS = 600;
const DEGREE_RADIUS_FACTOR = 20;

async function resolveFarcasterWithTimeout(addresses: string[]) {
  const rawTimeout = Number(
    import.meta.env.VITE_FARCASTER_TIMEOUT_MS ?? DEFAULT_FARCASTER_TIMEOUT_MS
  );
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : DEFAULT_FARCASTER_TIMEOUT_MS;

  return Promise.race([
    resolveNeynarProfiles(addresses),
    new Promise<Record<string, { username?: string; avatarUrl?: string }>>(
      (resolve) => {
        setTimeout(() => resolve({}), timeoutMs);
      }
    ),
  ]);
}

function layoutNodes(nodes: Node[], edges: Edge[]) {
  // Load saved positions from localStorage
  const savedPositions = loadNodePositions();

  // Assign positions to nodes:
  // 1. Use saved position if available
  // 2. Otherwise generate a random position for new users
  for (const node of nodes) {
    if (node.type === "user") {
      const savedPos = savedPositions[node.id];
      if (savedPos) {
        // Use saved position
        node.position = savedPos;
      } else {
        // Generate random position for new user
        node.position = generateRandomPosition();
      }
    } else {
      // For non-user nodes, use default position (shouldn't happen in current implementation)
      node.position = { x: 0, y: 0 };
    }
  }
}

function safeBigInt(value?: string) {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function computePerUnitFlowRate(pool: Pool) {
  let perUnitFlowRate = safeBigInt(pool.perUnitFlowRate);
  if (perUnitFlowRate > 0n) return perUnitFlowRate;

  const flowRate = safeBigInt(pool.flowRate);
  let totalUnits = safeBigInt(pool.totalUnits);
  if (totalUnits <= 0n) {
    totalUnits =
      pool.poolMembers?.reduce((sum, member) => {
        return sum + safeBigInt(member.units);
      }, 0n) ?? 0n;
  }

  if (totalUnits > 0n && flowRate > 0n) {
    perUnitFlowRate = flowRate / totalUnits;
  }
  return perUnitFlowRate;
}

export async function buildGraphElements(
  data: BeamrData
): Promise<GraphElements> {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const userAddresses = new Set<string>();
  const nodeIdSet = new Set<string>();
  const perUnitFlowRateByPool = new Map<string, bigint>();
  const poolInfoByDistributor = new Map<string, PoolInfo[]>();
  const decimals = Number(import.meta.env.VITE_BEAMR_DECIMALS ?? DEFAULT_DECIMALS);
  
  // Track flow stats per user (we'll aggregate after creating edges)
  const incomingFlowsByUser = new Map<string, { totalFlowRate: bigint; senders: Set<string> }>();
  const outgoingFlowsByUser = new Map<string, { totalFlowRate: bigint; receivers: Set<string> }>();
  
  // Track edges between node pairs to assign different curvatures
  const edgeCountByPair = new Map<string, number>();

  // First pass: compute pool info and associate with distributors
  for (const pool of data.pools) {
    const poolAddress = normalizeAddress(pool.id);
    const perUnitFlowRate = computePerUnitFlowRate(pool);
    perUnitFlowRateByPool.set(poolAddress, perUnitFlowRate);
    const flowRateValue = safeBigInt(pool.flowRate);
    const flowRateLabel =
      flowRateValue > 0n ? formatFlowRate(flowRateValue.toString(), decimals) : undefined;
    const perUnitFlowRateLabel =
      perUnitFlowRate > 0n
        ? formatFlowRate(perUnitFlowRate.toString(), decimals)
        : undefined;
    const memberCount = pool.poolMembers?.filter(
      (m) => m.isConnected !== false && safeBigInt(m.units) > 0n
    ).length ?? 0;

    const poolInfo: PoolInfo = {
      address: poolAddress,
      totalUnits: pool.totalUnits ?? "0",
      flowRate: flowRateValue.toString(),
      flowRateLabel,
      perUnitFlowRateLabel,
      memberCount,
    };

    // Associate pool info with each distributor
    for (const distributor of pool.poolDistributors ?? []) {
      const distributorAddress = normalizeAddress(distributor.account.id);
      const existing = poolInfoByDistributor.get(distributorAddress) ?? [];
      existing.push(poolInfo);
      poolInfoByDistributor.set(distributorAddress, existing);
    }
  }

  const ensureUserNode = (address: string) => {
    const normalized = normalizeAddress(address);
    const nodeId = makeAccountNodeId(normalized);
    if (nodeIdSet.has(nodeId)) return;
    const distributedPools = poolInfoByDistributor.get(normalized);
    nodes.push({
      id: nodeId,
      type: "user",
      data: {
        address: normalized,
        label: shortenAddress(normalized),
        kind: "user",
        distributedPools,
      } satisfies UserNodeData,
      position: { x: 0, y: 0 },
    });
    nodeIdSet.add(nodeId);
    userAddresses.add(normalized);
  };

  // Create edges directly from distributors to members
  for (const pool of data.pools) {
    const poolAddress = normalizeAddress(pool.id);
    const poolDistributors = pool.poolDistributors ?? [];
    
    // Ensure all distributor nodes exist
    for (const distributor of poolDistributors) {
      const distributorAddress = normalizeAddress(distributor.account.id);
      ensureUserNode(distributorAddress);
    }

    const perUnitFlowRate = perUnitFlowRateByPool.get(poolAddress) ?? 0n;
    const canComputeFlows = perUnitFlowRate > 0n;

    for (const member of pool.poolMembers ?? []) {
      if (member.isConnected === false) continue;
      let units = 0n;
      try {
        units = BigInt(member.units ?? "0");
      } catch {
        units = 0n;
      }
      if (units <= 0n) continue;
      const memberFlowRate = canComputeFlows ? perUnitFlowRate * units : 0n;

      const memberAddress = normalizeAddress(member.account.id);
      ensureUserNode(memberAddress);
      
      // Create edge from each distributor to this member
      for (const distributor of poolDistributors) {
        const distributorAddress = normalizeAddress(distributor.account.id);
        const source = makeAccountNodeId(distributorAddress);
        const target = makeAccountNodeId(memberAddress);
        
        // Skip self-edges
        if (source === target) continue;
        
        // Create a key for this source-target pair to track edge count
        const pairKey = `${source}-${target}`;
        const edgeIndex = edgeCountByPair.get(pairKey) ?? 0;
        edgeCountByPair.set(pairKey, edgeIndex + 1);
        
        // Assign high alternating curvature for maximum separation
        // First edge curves one way, second edge curves the opposite way
        // Using maximum curvature values (1.0 and -1.0) for clear visual separation
        const curvature = edgeIndex % 2 === 0 ? 1.0 : -1.0;
        
        const flowRateStr = memberFlowRate.toString();
        const strokeWidth = canComputeFlows
          ? flowRateToStrokeWidth(flowRateStr)
          : 1.5;
        edges.push({
          id: `distribution:${poolAddress}:${distributorAddress}:${memberAddress}`,
          source,
          target,
          type: "simplebezier",
          animated: true,
          pathOptions: {
            curvature,
          },
          style: {
            strokeWidth,
            stroke: "#38bdf8",
            strokeDasharray: canComputeFlows ? undefined : "6 4",
          },
          data: {
            flowRate: memberFlowRate.toString(),
            units: memberUnits,
          },
        } as Edge);
        
        // Track flow stats for both parties
        // Incoming flows for the member (receiver)
        const memberIncoming = incomingFlowsByUser.get(memberAddress) ?? { totalFlowRate: 0n, senders: new Set<string>() };
        memberIncoming.totalFlowRate += memberFlowRate;
        memberIncoming.senders.add(distributorAddress);
        incomingFlowsByUser.set(memberAddress, memberIncoming);
        
        // Outgoing flows for the distributor (sender)
        const distributorOutgoing = outgoingFlowsByUser.get(distributorAddress) ?? { totalFlowRate: 0n, receivers: new Set<string>() };
        distributorOutgoing.totalFlowRate += memberFlowRate;
        distributorOutgoing.receivers.add(memberAddress);
        outgoingFlowsByUser.set(distributorAddress, distributorOutgoing);
      }
    }
  }

  let farcasterProfiles: Record<
    string,
    { username?: string; avatarUrl?: string }
  > = {};
  try {
    farcasterProfiles = await resolveFarcasterWithTimeout(
      Array.from(userAddresses)
    );
  } catch {
    farcasterProfiles = {};
  }

  for (const node of nodes) {
    if (node.type !== "user") continue;
    const data = node.data as UserNodeData;
    const profile = farcasterProfiles[data.address];
    const farcaster = profile?.username;
    
    // Get flow stats for this user
    const incomingStats = incomingFlowsByUser.get(data.address);
    const outgoingStats = outgoingFlowsByUser.get(data.address);
    
    node.data = {
      ...data,
      farcaster,
      avatarUrl: profile?.avatarUrl,
      label: farcaster ? `@${farcaster}` : data.label,
      incomingFlows: incomingStats ? {
        totalFlowRate: incomingStats.totalFlowRate,
        userCount: incomingStats.senders.size,
      } : undefined,
      outgoingFlows: outgoingStats ? {
        totalFlowRate: outgoingStats.totalFlowRate,
        userCount: outgoingStats.receivers.size,
      } : undefined,
    };
  }

  layoutNodes(nodes, edges);

  return { nodes, edges };
}

