import { useState, useEffect, useMemo, useRef } from "react";
import type { Node } from "reactflow";

type UserData = {
  address: string;
  label: string;
  farcaster?: string;
  avatarUrl?: string;
};

type FindYourselfModalProps = {
  nodes: Node[];
  onSelectNode: (nodeId: string) => void;
  onSkip: () => void;
};

const LOCALSTORAGE_KEY = "beamr-find-yourself-dismissed";

/** Check whether the modal should show (no ?user= param AND not previously dismissed) */
export function shouldShowFindYourselfModal(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("user")) return false;
  try {
    if (localStorage.getItem(LOCALSTORAGE_KEY)) return false;
  } catch {
    // localStorage unavailable
  }
  return true;
}

/** Mark the modal as dismissed so it won't show again */
function dismissModal() {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export default function FindYourselfModal({
  nodes,
  onSelectNode,
  onSkip,
}: FindYourselfModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount
  useEffect(() => {
    // Small delay so the modal transition finishes first
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Search through nodes for matches
  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q || q.length < 2) return [];

    return nodes
      .filter((node) => {
        if (node.type !== "user") return false;
        const data = node.data as UserData;
        // Match against address, label, or farcaster username
        if (data.address.toLowerCase().includes(q)) return true;
        if (data.label.toLowerCase().includes(q)) return true;
        if (data.farcaster && data.farcaster.toLowerCase().includes(q))
          return true;
        return false;
      })
      .slice(0, 8) // Limit results
      .map((node) => ({
        id: node.id,
        data: node.data as UserData,
      }));
  }, [nodes, query]);

  const handleSelect = (nodeId: string) => {
    dismissModal();
    onSelectNode(nodeId);
  };

  const handleSkip = () => {
    dismissModal();
    onSkip();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md animate-modal-enter">
        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl shadow-cyan-500/20 ring-1 ring-cyan-400/20 backdrop-blur-md">
          {/* Header */}
          <div className="px-6 pt-6 pb-2 text-center">
            <div className="mb-3 text-3xl">🔍</div>
            <h2 className="text-xl font-bold text-slate-100">
              Find Yourself
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Search by your Farcaster username or wallet address to see your
              position in the BEAMR economy
            </p>
          </div>

          {/* Search Input */}
          <div className="px-6 py-4">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. @username or 0x..."
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/80 py-3 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              />
            </div>
          </div>

          {/* Results */}
          {query.trim().length >= 2 && (
            <div className="max-h-64 overflow-y-auto border-t border-slate-700/30 px-3 py-2">
              {matches.length > 0 ? (
                matches.map((match) => (
                  <button
                    key={match.id}
                    onClick={() => handleSelect(match.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-cyan-500/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-400/30 bg-slate-800">
                      {match.data.avatarUrl ? (
                        <img
                          src={match.data.avatarUrl}
                          alt={match.data.label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold text-slate-400">
                          {match.data.label.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {match.data.label}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {match.data.address.slice(0, 6)}...
                        {match.data.address.slice(-4)}
                      </div>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-cyan-400/60"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                ))
              ) : (
                <div className="py-6 text-center text-sm text-slate-500">
                  No matching users found
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="border-t border-slate-700/30 px-6 py-4">
            <button
              onClick={handleSkip}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              Skip — I'll just explore
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
