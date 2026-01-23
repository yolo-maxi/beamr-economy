const DEFAULT_DECIMALS = 18;

export function normalizeAddress(address: string) {
  return address.toLowerCase();
}

export function shortenAddress(address: string, size = 4) {
  if (!address) return "";
  const normalized = normalizeAddress(address);
  return `${normalized.slice(0, size + 2)}...${normalized.slice(-size)}`;
}

export function formatFlowRate(flowRate: string, decimals = DEFAULT_DECIMALS) {
  try {
    const raw = BigInt(flowRate ?? "0");
    const daily = raw * 86400n;
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = daily / divisor;
    const fraction = daily % divisor;
    const fractionStr = fraction
      .toString()
      .padStart(decimals, "0")
      .slice(0, 4);
    return `${whole.toString()}.${fractionStr} /day`;
  } catch {
    return `${flowRate} /day`;
  }
}

/**
 * Format a number compactly with B/M/K suffix and max 2 decimals
 * e.g. 1234567 -> "1.23M", 12345 -> "12.35K", 123 -> "123"
 */
export function formatCompact(value: number): string {
  if (value === 0) return "0";
  
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  
  if (absValue >= 1_000_000_000) {
    const formatted = (absValue / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "");
    return `${sign}${formatted}B`;
  }
  if (absValue >= 1_000_000) {
    const formatted = (absValue / 1_000_000).toFixed(2).replace(/\.?0+$/, "");
    return `${sign}${formatted}M`;
  }
  if (absValue >= 1_000) {
    const formatted = (absValue / 1_000).toFixed(2).replace(/\.?0+$/, "");
    return `${sign}${formatted}K`;
  }
  if (absValue >= 1) {
    // For values >= 1, show max 2 decimal places
    const formatted = absValue.toFixed(2).replace(/\.?0+$/, "");
    return `${sign}${formatted}`;
  }
  // For very small values, show up to 4 significant decimal digits
  const formatted = absValue.toPrecision(2);
  return `${sign}${formatted}`;
}

/**
 * Format a bigint flow rate as compact daily rate
 * Returns null if flow rate is 0
 */
export function formatCompactFlowRate(flowRate: bigint, decimals = DEFAULT_DECIMALS): string | null {
  if (flowRate <= 0n) return null;
  
  const daily = flowRate * 86400n;
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = daily / divisor;
  const fraction = daily % divisor;
  
  // Convert to number for formatting (safe for display purposes)
  const fractionNum = Number(fraction) / Number(divisor);
  const totalValue = Number(whole) + fractionNum;
  
  return formatCompact(totalValue);
}

export function flowRateToStrokeWidth(flowRate: string) {
  const digits = flowRate.replace(/^0+/, "").length;
  if (digits === 0) return 1;
  return Math.min(6, 1 + digits / 6);
}

const NODE_POSITIONS_STORAGE_KEY = "beamr_node_positions";

export type NodePosition = {
  x: number;
  y: number;
};

export type NodePositions = Record<string, NodePosition>;

/**
 * Load saved node positions from localStorage
 */
export function loadNodePositions(): NodePositions {
  try {
    const stored = localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as NodePositions;
    // Validate that all entries have x and y numbers
    const valid: NodePositions = {};
    for (const [nodeId, pos] of Object.entries(parsed)) {
      if (
        typeof pos === "object" &&
        pos !== null &&
        typeof pos.x === "number" &&
        typeof pos.y === "number" &&
        Number.isFinite(pos.x) &&
        Number.isFinite(pos.y)
      ) {
        valid[nodeId] = { x: pos.x, y: pos.y };
      }
    }
    return valid;
  } catch {
    return {};
  }
}

/**
 * Save node positions to localStorage
 */
export function saveNodePositions(positions: NodePositions): void {
  try {
    localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch (err) {
    console.warn("Failed to save node positions to localStorage:", err);
  }
}

/**
 * Generate a random position for a new node
 */
export function generateRandomPosition(): NodePosition {
  // Generate position in a large circle (similar to layoutNodes initial positions)
  const angle = Math.random() * Math.PI * 2;
  const radius = 1000 + Math.random() * 3000;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

