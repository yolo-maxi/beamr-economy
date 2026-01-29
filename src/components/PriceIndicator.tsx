import { useEffect, useState, useRef } from "react";

type PriceData = {
  price: number;
  previousPrice: number | null;
};

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const COIN_ID = "ethereum"; // Can be changed to any coin on CoinGecko
const POLL_INTERVAL_MS = 30_000; // 30 seconds (CoinGecko rate limits)

export default function PriceIndicator() {
  const [data, setData] = useState<PriceData | null>(null);
  const [error, setError] = useState(false);
  const previousPriceRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        const res = await fetch(
          `${COINGECKO_API}?ids=${COIN_ID}&vs_currencies=usd`
        );
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        const price = json[COIN_ID]?.usd;
        
        if (mounted && typeof price === "number") {
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
        <span>ETH --</span>
      </div>
    );
  }

  const { price, previousPrice } = data;
  const priceDirection = previousPrice === null 
    ? "neutral" 
    : price > previousPrice 
      ? "up" 
      : price < previousPrice 
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

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ring-1 transition-all duration-500 ${bgClass}`}
    >
      <span className="text-slate-400">ETH</span>
      <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
        ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {arrowIcon && (
        <span className={`text-sm ${colorClass}`}>{arrowIcon}</span>
      )}
    </div>
  );
}
