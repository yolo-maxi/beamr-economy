import { useCallback, useEffect, useRef, useState } from "react";

type PriceData = {
  price: number;
  priceChange24h: number | null;
};

type PriceIndicatorProps = {
  activeStreamCount?: number;
};

// BEAMR token on Base chain
const BEAMR_TOKEN = "0x22f1cd353441351911691EE4049c7b773abb1ecF";
const DEXSCREENER_API = `https://api.dexscreener.com/latest/dex/tokens/${BEAMR_TOKEN}`;
const SUBGRAPH_URL = "https://subgraph-endpoints.superfluid.dev/base-mainnet/protocol-v1";
const POLL_INTERVAL_MS = 20_000; // 20 seconds
const VOLUME_POLL_INTERVAL_MS = 120_000; // 2 minutes for volume
const TOTAL_SUPPLY = 100_000_000_000; // 100 billion BEAMR tokens
const TOKEN_DECIMALS = 18;

const VOLUME_QUERY = `{
  tokenStatistics(where: { token: "${BEAMR_TOKEN.toLowerCase()}" }) {
    totalAmountStreamedUntilUpdatedAt
    totalAmountDistributedUntilUpdatedAt
    totalAmountTransferredUntilUpdatedAt
    totalOutflowRate
    updatedAtTimestamp
  }
}`;

function formatVolume(beamrAmount: number): string {
  // Format with commas, no unit suffix — just the raw token count
  // e.g. 3,486,116,234,567
  const rounded = Math.floor(beamrAmount);
  return rounded.toLocaleString('en-US');
}

// Basescan icon - simple block explorer icon
function BasescanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 hover:text-slate-200 transition-colors">
      <rect x="2" y="2" width="20" height="20" rx="3" />
      <path d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  );
}

// DexScreener icon - chart-style icon
function DexScreenerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 hover:text-slate-200 transition-colors">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

// Social link buttons
function SocialLinks() {
  return (
    <div className="flex items-center gap-1.5">
      <a
        href="https://basescan.org/token/0x22f1cd353441351911691EE4049c7b773abb1ecF"
        target="_blank"
        rel="noopener noreferrer"
        title="View on Basescan"
        className="flex items-center justify-center rounded-md bg-slate-800/60 p-1.5 ring-1 ring-slate-700/50 hover:bg-slate-700/60 hover:ring-slate-600/50 transition-all"
      >
        <BasescanIcon />
      </a>
      <a
        href="https://dexscreener.com/base/0x22f1cd353441351911691EE4049c7b773abb1ecF"
        target="_blank"
        rel="noopener noreferrer"
        title="View on DexScreener"
        className="flex items-center justify-center rounded-md bg-slate-800/60 p-1.5 ring-1 ring-slate-700/50 hover:bg-slate-700/60 hover:ring-slate-600/50 transition-all"
      >
        <DexScreenerIcon />
      </a>
    </div>
  );
}

export default function PriceIndicator({ activeStreamCount }: PriceIndicatorProps) {
  const [data, setData] = useState<PriceData | null>(null);
  const [error, setError] = useState(false);
  const [totalVolume, setTotalVolume] = useState<number | null>(null);
  const [flowRatePerSec, setFlowRatePerSec] = useState<number>(0);
  const [snapshotTime, setSnapshotTime] = useState<number>(0);
  const [displayVolume, setDisplayVolume] = useState<number | null>(null);
  const rafRef = useRef<number>(0);

  // Fetch price from DexScreener
  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        const res = await fetch(DEXSCREENER_API);
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        
        const pair = json?.pairs?.[0];
        const priceStr = pair?.priceUsd;
        const price = priceStr ? parseFloat(priceStr) : null;
        const priceChange24h = pair?.priceChange?.h24 ? parseFloat(pair.priceChange.h24) : null;
        
        if (mounted && typeof price === "number" && !isNaN(price)) {
          setData({ price, priceChange24h });
          setError(false);
        }
      } catch {
        if (mounted) setError(true);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, POLL_INTERVAL_MS);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch total volume from Superfluid subgraph
  useEffect(() => {
    let mounted = true;

    const fetchVolume = async () => {
      try {
        const res = await fetch(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: VOLUME_QUERY }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const stats = json?.data?.tokenStatistics?.[0];
        if (!stats) return;
        
        const streamed = BigInt(stats.totalAmountStreamedUntilUpdatedAt || "0");
        const distributed = BigInt(stats.totalAmountDistributedUntilUpdatedAt || "0");
        const transferred = BigInt(stats.totalAmountTransferredUntilUpdatedAt || "0");
        const total = streamed + distributed + transferred;
        const outflowRate = BigInt(stats.totalOutflowRate || "0");
        const updatedAt = Number(stats.updatedAtTimestamp || "0");
        
        // Convert from wei (18 decimals) to human-readable
        const divisor = BigInt(10) ** BigInt(TOKEN_DECIMALS);
        const humanReadable = Number(total / divisor);
        const ratePerSec = Number(outflowRate) / 1e18;
        
        if (mounted) {
          setTotalVolume(humanReadable);
          setFlowRatePerSec(ratePerSec);
          setSnapshotTime(updatedAt);
        }
      } catch {
        // Silently fail — volume is a nice-to-have
      }
    };

    fetchVolume();
    const interval = setInterval(fetchVolume, VOLUME_POLL_INTERVAL_MS);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Animate volume ticking up based on flow rate
  useEffect(() => {
    if (totalVolume === null || flowRatePerSec === 0 || snapshotTime === 0) {
      setDisplayVolume(totalVolume);
      return;
    }

    const animate = () => {
      const nowSec = Date.now() / 1000;
      const elapsed = nowSec - snapshotTime;
      const additional = elapsed > 0 ? flowRatePerSec * elapsed : 0;
      setDisplayVolume(totalVolume + additional);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [totalVolume, flowRatePerSec, snapshotTime]);

  const shownVolume = displayVolume ?? totalVolume;

  if (error || !data) {
    return (
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-slate-500 animate-pulse" />
          <span>$BEAMR --</span>
        </div>
        {shownVolume !== null && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400" title="All-time tipping volume (streamed + distributed + transferred)">
            <span className="text-slate-500">All time tips:</span>
            <span className="font-mono font-semibold text-slate-300">{formatVolume(shownVolume)} $BEAMR</span>
          </div>
        )}
        {activeStreamCount !== undefined && activeStreamCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs ring-1 ring-slate-700/50" title="Active streams">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-medium">{activeStreamCount} streams</span>
          </div>
        )}
        <SocialLinks />
      </div>
    );
  }

  const { price, priceChange24h } = data;
  
  // Calculate market cap (price * total supply)
  const marketCap = price * TOTAL_SUPPLY;
  
  const isUp = priceChange24h !== null && priceChange24h >= 0;
  const isDown = priceChange24h !== null && priceChange24h < 0;
  
  const colorClass = isUp ? "text-emerald-400" : isDown ? "text-red-400" : "text-slate-200";
  const bgClass = isUp 
    ? "bg-emerald-500/10 ring-emerald-500/30" 
    : isDown 
      ? "bg-red-500/10 ring-red-500/30" 
      : "bg-slate-800/60 ring-slate-700/50";

  // Format market cap in a readable way
  const formatMarketCap = (mc: number): string => {
    if (mc >= 1_000_000_000) {
      return `$${(mc / 1_000_000_000).toFixed(2)}B`;
    } else if (mc >= 1_000_000) {
      return `$${(mc / 1_000_000).toFixed(2)}M`;
    } else if (mc >= 1_000) {
      return `$${(mc / 1_000).toFixed(2)}K`;
    } else {
      return `$${mc.toFixed(2)}`;
    }
  };

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ring-1 transition-all duration-500 ${bgClass}`}
        title={`FDV (Fully Diluted Value)\nPrice: $${price.toExponential(4)}\nSupply: 100B tokens\n24h Change: ${priceChange24h?.toFixed(2) ?? 'N/A'}%`}
      >
        <span className="text-cyan-400 font-medium">$BEAMR</span>
        <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
          {formatMarketCap(marketCap)}
        </span>
        
        {/* 24h Change Indicator */}
        {priceChange24h !== null && (
          <div className={`flex items-center gap-0.5 ${colorClass}`}>
            <span className="text-[10px]">{isUp ? "▲" : "▼"}</span>
            <span className="text-[10px] font-medium">
              {Math.abs(priceChange24h).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
      
      {/* Total Volume */}
      {shownVolume !== null && (
        <div
          className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs ring-1 ring-slate-700/50"
          title={`All-time tipping volume\n${Math.floor(shownVolume).toLocaleString()} BEAMR\n(streamed + distributed + transferred)`}
        >
          <span className="text-slate-400 font-medium">All time tips:</span>
          <span className="font-mono font-semibold tabular-nums text-purple-300">{formatVolume(shownVolume)} $BEAMR</span>
        </div>
      )}
      
      {/* Active Streams Counter */}
      {activeStreamCount !== undefined && activeStreamCount > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs ring-1 ring-slate-700/50" title="Active streams">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300 font-medium">{activeStreamCount} streams</span>
        </div>
      )}
      
      {/* Social Links */}
      <SocialLinks />
    </div>
  );
}
