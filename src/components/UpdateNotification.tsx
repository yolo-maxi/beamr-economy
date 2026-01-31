import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAnnotations, type AnnotationSummary } from "agentation";

interface UpdateNotificationProps {
  editToken: string;
  pollInterval?: number;
}

// Pulsing indicator at annotation location
function PinPulse({ x, y, onComplete }: { x: number; y: number; onComplete?: () => void }) {
  return (
    <div
      className="fixed pointer-events-none z-[90]"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
    >
      {/* Outer expanding rings */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-purple-500/40 animate-ping-slow" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-purple-400/20 animate-ping-slower" style={{ animationDelay: '0.3s' }} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-purple-300/10 animate-ping-slowest" style={{ animationDelay: '0.6s' }} />
      </div>
      
      {/* Center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-purple-500 shadow-lg shadow-purple-500/50 animate-pulse-bright">
          <div className="absolute inset-0 rounded-full bg-white/30 animate-sparkle" />
        </div>
      </div>
      
      {/* Sparkle particles */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="absolute w-1 h-1 bg-purple-300 rounded-full animate-particle-1" />
        <div className="absolute w-1 h-1 bg-purple-200 rounded-full animate-particle-2" />
        <div className="absolute w-1 h-1 bg-white rounded-full animate-particle-3" />
        <div className="absolute w-1 h-1 bg-purple-400 rounded-full animate-particle-4" />
      </div>
    </div>
  );
}

export default function UpdateNotification({ editToken, pollInterval = 5000 }: UpdateNotificationProps) {
  const [pendingUpdates, setPendingUpdates] = useState<AnnotationSummary[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const previousStates = useRef<Map<string, string>>(new Map());
  const isFirstLoad = useRef(true);

  const checkForUpdates = useCallback(async () => {
    const annotations = await fetchAnnotations(editToken, true);
    
    // On first load, just record states without showing notifications
    if (isFirstLoad.current) {
      annotations.forEach(a => {
        previousStates.current.set(a.id, a.status);
      });
      isFirstLoad.current = false;
      return;
    }

    // Check for annotations that just became "implemented"
    const newlyImplemented: AnnotationSummary[] = [];
    
    annotations.forEach(a => {
      const prevStatus = previousStates.current.get(a.id);
      
      // If it was processing/pending and now is implemented, it's new!
      if (a.status === "implemented" && prevStatus && prevStatus !== "implemented") {
        newlyImplemented.push(a);
      }
      
      // Update state
      previousStates.current.set(a.id, a.status);
    });

    if (newlyImplemented.length > 0) {
      setPendingUpdates(prev => {
        // Add new ones, avoid duplicates
        const existingIds = new Set(prev.map(p => p.id));
        const toAdd = newlyImplemented.filter(a => !existingIds.has(a.id));
        return [...prev, ...toAdd];
      });
      setIsVisible(true);
    }
  }, [editToken]);

  // Poll for updates
  useEffect(() => {
    checkForUpdates(); // Initial check
    const interval = setInterval(checkForUpdates, pollInterval);
    return () => clearInterval(interval);
  }, [checkForUpdates, pollInterval]);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleDismiss = (id: string) => {
    setPendingUpdates(prev => prev.filter(p => p.id !== id));
    if (pendingUpdates.length <= 1) {
      setIsVisible(false);
    }
  };

  const handleDismissAll = () => {
    setPendingUpdates([]);
    setIsVisible(false);
  };

  if (!isVisible || pendingUpdates.length === 0) {
    return null;
  }

  return (
    <>
      {/* Pulsing indicators at annotation locations */}
      {pendingUpdates.map((update) => (
        <PinPulse key={`pin-${update.id}`} x={update.x} y={update.y} />
      ))}

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-[100003] flex flex-col gap-2 max-w-sm">
        {pendingUpdates.map((update, index) => (
          <div
            key={update.id}
            className="animate-slide-in-right"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="relative overflow-hidden bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-2xl shadow-purple-500/30">
              {/* Animated shine effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shine" />
              
              {/* Pulsing border */}
              <div className="absolute inset-0 rounded-xl border-2 border-white/30 animate-pulse-border" />
              
              <div className="relative p-4">
                <div className="flex items-start gap-3">
                  {/* Animated icon */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-bounce-slow">
                    <span className="text-2xl">✨</span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">
                      Update Ready!
                    </p>
                    <p className="text-xs text-white/80 mt-0.5 truncate">
                      {update.comment.slice(0, 50)}{update.comment.length > 50 ? '...' : ''}
                    </p>
                    <p className="text-xs text-white/60 mt-1">
                      by {update.tokenOwner}
                    </p>
                  </div>

                  {/* Dismiss button */}
                  <button
                    onClick={() => handleDismiss(update.id)}
                    className="flex-shrink-0 p-1 text-white/60 hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleRefresh}
                    className="flex-1 px-3 py-2 text-sm font-semibold bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 animate-spin-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh to see changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Dismiss all if multiple */}
        {pendingUpdates.length > 1 && (
          <button
            onClick={handleDismissAll}
            className="self-end px-3 py-1 text-xs text-white/60 hover:text-white transition-colors"
          >
            Dismiss all ({pendingUpdates.length})
          </button>
        )}
      </div>
    </>
  );
}
