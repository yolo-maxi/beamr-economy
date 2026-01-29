import { useEffect, useState } from "react";

type PriceData = {
  price: number;
  priceChange24h: number | null;
};

// BEAMR token on Base chain
const BEAMR_TOKEN = "0x22f1cd353441351911691EE4049c7b773abb1ecF";
const DEXSCREENER_API = `https://api.dexscreener.com/latest/dex/tokens/${BEAMR_TOKEN}`;
const POLL_INTERVAL_MS = 20_000; // 20 seconds
const TOTAL_SUPPLY = 100_000_000_000; // 100 billion BEAMR tokens

export default function PriceIndicator() {
  const [data, setData] = useState<PriceData | null>(null);
  const [error, setError] = useState(false);

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

  if (error || !data) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400">
        <span className="h-2 w-2 rounded-full bg-slate-500 animate-pulse" />
        <span>$BEAMR --</span>
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
  );
}
