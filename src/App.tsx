import { useEffect, useState } from "react";
import FlowGraph from "./components/FlowGraph";
import { fetchUserByUsername } from "./lib/farcaster";

export default function App() {
  const [beamrLogo, setBeamrLogo] = useState<string | null>(null);

  useEffect(() => {
    fetchUserByUsername("beamr").then((user) => {
      if (user?.avatarUrl) {
        setBeamrLogo(user.avatarUrl);
      }
    });
  }, []);

  return (
    <div className="relative h-full w-full">
      <FlowGraph />
      {/* Floating title - positioned outside ReactFlow to avoid clipping */}
      <div className="pointer-events-none fixed left-6 top-6 z-50">
        <div className="flex items-center gap-5">
          {beamrLogo && (
            <div className="relative">
              {/* Animated glow background */}
              <div className="absolute -inset-4 rounded-2xl bg-cyan-400/30 blur-2xl animate-title-glow" />
              <div className="absolute -inset-6 rounded-3xl bg-cyan-500/20 blur-3xl animate-title-glow" />
              <img
                src={beamrLogo}
                alt="BEAMR"
                className="relative h-14 w-14 rounded-xl shadow-xl shadow-cyan-500/60 ring-2 ring-cyan-400/40"
              />
            </div>
          )}
          <div className="relative">
            {/* Animated glow background for text */}
            <div className="absolute -inset-x-4 -inset-y-2 rounded-xl bg-cyan-400/25 blur-2xl animate-text-glow" />
            <div className="absolute -inset-x-6 -inset-y-3 rounded-2xl bg-cyan-500/15 blur-3xl animate-text-glow" />
            <h1 className="relative font-pixel text-2xl tracking-widest text-cyan-100 animate-text-shimmer">
              ECONOMY
            </h1>
          </div>
        </div>
      </div>
    </div>
  );
}

