import { useEffect, useState, useCallback } from "react";
import FlowGraph from "./components/FlowGraph";
import PriceIndicator from "./components/PriceIndicator";
import UpdateNotification from "./components/UpdateNotification";
import { fetchUserByUsername } from "./lib/farcaster";
import { 
  Agentation, 
  ReviewPanel,
  type Annotation,
  type TokenValidation,
  checkAndSaveEditToken, 
  validateToken, 
  submitAnnotations, 
  AGENTATION_API,
} from "vibeclaw";

export default function App() {
  const [beamrLogo, setBeamrLogo] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenValidation | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeStreamCount, setActiveStreamCount] = useState(0);

  // Check for edit token on mount
  useEffect(() => {
    const token = checkAndSaveEditToken();
    if (token) {
      validateToken(token).then((info) => {
        if (info.valid) {
          setEditToken(token);
          setTokenInfo(info);
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
      <FlowGraph onStreamCountChange={setActiveStreamCount} />
      {/* Floating title - positioned outside ReactFlow to avoid clipping */}
      <div className="pointer-events-none fixed left-3 top-3 z-50 sm:left-6 sm:top-6">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-5">
          {/* Row 1 on mobile: Logo + Token name + Price */}
          <div className="flex items-center gap-1.5 sm:gap-5">
            {beamrLogo && (
              <div className="relative">
                <div className="absolute -inset-2 rounded-xl bg-cyan-400/30 blur-lg animate-title-glow sm:-inset-4 sm:blur-2xl" />
                <img
                  src={beamrLogo}
                  alt="BEAMR"
                  className="relative h-7 w-7 rounded-md shadow-lg shadow-cyan-500/60 ring-1 ring-cyan-400/40 sm:h-14 sm:w-14 sm:rounded-xl sm:ring-2"
                />
              </div>
            )}
            <div className="relative">
              <div className="absolute -inset-x-2 -inset-y-0.5 rounded-md bg-cyan-400/25 blur-lg animate-text-glow sm:-inset-x-4 sm:-inset-y-2 sm:rounded-xl sm:blur-2xl" />
              <h1 className="relative font-pixel text-sm tracking-widest text-cyan-100 animate-text-shimmer sm:text-2xl">
                ECONOMY
              </h1>
            </div>
          </div>
          {/* Row 2 on mobile: Price + Volume */}
          <div className="pointer-events-auto">
            <PriceIndicator activeStreamCount={activeStreamCount} />
          </div>
        </div>
      </div>
      
      {isEditMode && editToken && (
        <>
          {/* Update notification - polls and shows when changes are ready */}
          <UpdateNotification 
            editToken={editToken} 
            pollInterval={5000}
          />
          
          {tokenInfo && (
            <Agentation
              apiMode
              apiEndpoint={AGENTATION_API}
              editToken={editToken}
              onSend={handleSend}
              pollInterval={20000}
              multiplayerMode
              defaultMultiplayer
              customButtons={
                <ReviewPanel
                  editToken={editToken}
                  tokenInfo={tokenInfo}
                />
              }
            />
          )}
        </>
      )}
    </div>
  );
}
