import { useEffect, useState, useCallback } from "react";
import FlowGraph from "./components/FlowGraph";
import PriceIndicator from "./components/PriceIndicator";
import { fetchUserByUsername } from "./lib/farcaster";
import { Agentation, type Annotation } from "agentation";
import { checkAndSaveEditToken, validateToken, submitAnnotations, AGENTATION_API } from "./lib/agentation";

export default function App() {
  const [beamrLogo, setBeamrLogo] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  // Check for edit token on mount
  useEffect(() => {
    const token = checkAndSaveEditToken();
    if (token) {
      validateToken(token).then(({ valid }) => {
        if (valid) {
          setEditToken(token);
          setIsEditMode(true);
        }
      });
    }
  }, []);

  useEffect(() => {
    fetchUserByUsername("beamr").then((user) => {
      if (user?.avatarUrl) {
        setBeamrLogo(user.avatarUrl);
      }
    });
  }, []);

  // Handle batch annotation submission (API mode)
  const handleSend = useCallback(async (annotations: Annotation[]) => {
    if (!editToken) return [];
    const results = await submitAnnotations(editToken, annotations);
    results.forEach(r => {
      if (r.success) {
        console.log("[Agentation] Submitted:", r.remoteId);
      } else {
        console.error("[Agentation] Failed:", r.id, r.error);
      }
    });
    return results;
  }, [editToken]);

  return (
    <div className="relative h-full w-full">
      <FlowGraph />
      {/* Floating title - positioned outside ReactFlow to avoid clipping */}
      <div className="pointer-events-none fixed left-4 top-4 z-50 sm:left-6 sm:top-6">
        <div className="flex items-center gap-3 sm:gap-5">
          {beamrLogo && (
            <div className="relative">
              {/* Animated glow background */}
              <div className="absolute -inset-3 rounded-2xl bg-cyan-400/30 blur-xl animate-title-glow sm:-inset-4 sm:blur-2xl" />
              <div className="absolute -inset-4 rounded-3xl bg-cyan-500/20 blur-2xl animate-title-glow sm:-inset-6 sm:blur-3xl" />
              <img
                src={beamrLogo}
                alt="BEAMR"
                className="relative h-10 w-10 rounded-lg shadow-xl shadow-cyan-500/60 ring-2 ring-cyan-400/40 sm:h-14 sm:w-14 sm:rounded-xl"
              />
            </div>
          )}
          <div className="relative">
            {/* Animated glow background for text */}
            <div className="absolute -inset-x-3 -inset-y-1 rounded-lg bg-cyan-400/25 blur-xl animate-text-glow sm:-inset-x-4 sm:-inset-y-2 sm:rounded-xl sm:blur-2xl" />
            <div className="absolute -inset-x-4 -inset-y-2 rounded-xl bg-cyan-500/15 blur-2xl animate-text-glow sm:-inset-x-6 sm:-inset-y-3 sm:rounded-2xl sm:blur-3xl" />
            <h1 className="relative font-pixel text-lg tracking-widest text-cyan-100 animate-text-shimmer sm:text-2xl">
              ECONOMY
            </h1>
          </div>
          <div className="pointer-events-auto">
            <PriceIndicator />
          </div>
        </div>
      </div>
      {isEditMode && (
        <Agentation
          apiMode
          apiEndpoint={AGENTATION_API}
          editToken={editToken || undefined}
          onSend={handleSend}
          pollInterval={20000}
          multiplayerMode
          defaultMultiplayer
        />
      )}
    </div>
  );
}

