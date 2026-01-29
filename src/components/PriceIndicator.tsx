import { useEffect, useState, useRef } from "react";

type PriceData = {
  price: number;
  previousPrice: number | null;
};

// BEAMR token on Base chain
const BEAMR_TOKEN = "0x22f1cd353441351911691EE4049c7b773abb1ecF";
const DEXSCREENER_API = `https://api.dexscreener.com/latest/dex/tokens/${BEAMR_TOKEN}`;
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const TOTAL_SUPPLY = 100_000_000_000; // 100 billion BEAMR tokens

export default function PriceIndicator() {
  const [data, setData] = useState<PriceData | null>(null);
  const [error, setError] = useState(false);
  const previousPriceRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        const res = await fetch(DEXSCREENER_API);
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        
        // Get price from first pair (most liquid)
        const priceStr = json?.pairs?.[0]?.priceUsd;
        const price = priceStr ? parseFloat(priceStr) : null;
        
        if (mounted && typeof price === "number" && !isNaN(price)) {
          setData((prev) => ({
            price,
            previousPrice: prev?.price ?? previousPriceRef.current,
          }));
          previousPriceRef.current = price;
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

  const { price, previousPrice } = data;
  
  // Calculate market cap (price * total supply)
  const marketCap = price * TOTAL_SUPPLY;
  const previousMarketCap = previousPrice ? previousPrice * TOTAL_SUPPLY : null;
  
  const priceDirection = previousMarketCap === null 
    ? "neutral" 
    : marketCap > previousMarketCap 
      ? "up" 
      : marketCap < previousMarketCap 
        ? "down" 
        : "neutral";

  const colorClass = 
    priceDirection === "up" 
      ? "text-emerald-400" 
      : priceDirection === "down" 
        ? "text-red-400" 
        : "text-slate-200";

  const bgClass =
    priceDirection === "up"
      ? "bg-emerald-500/10 ring-emerald-500/30"
      : priceDirection === "down"
        ? "bg-red-500/10 ring-red-500/30"
        : "bg-slate-800/60 ring-slate-700/50";

  const arrowIcon =
    priceDirection === "up" ? "↑" : priceDirection === "down" ? "↓" : "";

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
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ring-1 transition-all duration-500 ${bgClass}`}
      title={`Price: $${price.toExponential(2)} • Supply: 100B`}
    >
      <span className="text-cyan-400 font-medium">$BEAMR</span>
      <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
        {formatMarketCap(marketCap)}
      </span>
      {arrowIcon && (
        <span className={`text-sm ${colorClass}`}>{arrowIcon}</span>
      )}
    </div>
  );
}
