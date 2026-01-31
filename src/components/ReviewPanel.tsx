import { useState, useEffect, useCallback } from "react";
import {
  fetchAnnotations,
  approveAnnotation,
  rejectAnnotation,
  reviseAnnotation,
  type AnnotationSummary,
  type AnnotationStatus,
  type TokenValidation,
  AGENTATION_API,
} from "../lib/agentation";

interface ReviewPanelProps {
  editToken: string;
  tokenInfo: TokenValidation;
  onRefresh?: () => void;
}

// Map old statuses to display config
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: "Pending", color: "text-yellow-400", bg: "bg-yellow-400/20", icon: "⏳" },
  processing: { label: "Processing", color: "text-blue-400", bg: "bg-blue-400/20", icon: "⚙️" },
  implemented: { label: "Review", color: "text-purple-400", bg: "bg-purple-400/20", icon: "👀" },
  approved: { label: "Approved", color: "text-green-400", bg: "bg-green-400/20", icon: "✅" },
  completed: { label: "Done", color: "text-green-400", bg: "bg-green-400/20", icon: "✅" }, // Legacy
  rejected: { label: "Rejected", color: "text-red-400", bg: "bg-red-400/20", icon: "❌" },
  revision_requested: { label: "Revising", color: "text-orange-400", bg: "bg-orange-400/20", icon: "🔄" },
  failed: { label: "Failed", color: "text-red-500", bg: "bg-red-500/20", icon: "💥" },
  interrupted: { label: "Interrupted", color: "text-gray-400", bg: "bg-gray-400/20", icon: "⏸️" },
  archived: { label: "Archived", color: "text-gray-500", bg: "bg-gray-500/20", icon: "📦" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.color}`}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

function TimeAgo({ timestamp }: { timestamp: number }) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return <span>{seconds}s ago</span>;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return <span>{minutes}m ago</span>;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return <span>{hours}h ago</span>;
  const days = Math.floor(hours / 24);
  return <span>{days}d ago</span>;
}

interface RevisionModalProps {
  annotation: AnnotationSummary;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function RevisionModal({ annotation, onSubmit, onCancel, isLoading }: RevisionModalProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-white">Request Revision</h3>
          <p className="text-sm text-slate-400 mt-1">
            Describe what changes you want to the current implementation
          </p>
        </div>
        
        <div className="p-4">
          <div className="mb-4 p-3 bg-slate-800/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-1">Original request:</p>
            <p className="text-sm text-slate-300">{annotation.comment}</p>
          </div>
          
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Make the color darker, move it to the left, add more padding..."
            className="w-full h-32 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            autoFocus
          />
          
          {annotation.revisionCount > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              This annotation has been revised {annotation.revisionCount} time(s)
            </p>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(prompt)}
            disabled={isLoading || !prompt.trim()}
            className="px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Revision"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewPanel({ editToken, tokenInfo, onRefresh }: ReviewPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationSummary[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('hidden_annotations');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<AnnotationSummary | null>(null);
  const [filter, setFilter] = useState<"active" | "review" | "mine" | "all">("active");
  const [showHidden, setShowHidden] = useState(false);

  // Save hidden IDs to localStorage
  useEffect(() => {
    localStorage.setItem('hidden_annotations', JSON.stringify([...hiddenIds]));
  }, [hiddenIds]);

  const loadAnnotations = useCallback(async () => {
    setIsLoading(true);
    const data = await fetchAnnotations(editToken, true);
    // Sort by timestamp descending (newest first)
    data.sort((a, b) => b.timestamp - a.timestamp);
    setAnnotations(data);
    setIsLoading(false);
  }, [editToken]);

  useEffect(() => {
    if (isOpen) {
      loadAnnotations();
    }
  }, [isOpen, loadAnnotations]);

  // Poll for updates when panel is open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(loadAnnotations, 10000);
    return () => clearInterval(interval);
  }, [isOpen, loadAnnotations]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    const result = await approveAnnotation(editToken, id);
    if (result.success) {
      await loadAnnotations();
      onRefresh?.();
    } else {
      alert(result.error || "Failed to approve");
    }
    setActionLoading(null);
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Reason for rejection (optional):");
    setActionLoading(id);
    const result = await rejectAnnotation(editToken, id, reason || undefined);
    if (result.success) {
      await loadAnnotations();
      onRefresh?.();
    } else {
      alert(result.error || "Failed to reject");
    }
    setActionLoading(null);
  };

  const handleRevisionSubmit = async (prompt: string) => {
    if (!revisionTarget) return;
    setActionLoading(revisionTarget.id);
    const result = await reviseAnnotation(editToken, revisionTarget.id, prompt);
    if (result.success) {
      setRevisionTarget(null);
      await loadAnnotations();
      onRefresh?.();
    } else {
      alert(result.error || "Failed to submit revision");
    }
    setActionLoading(null);
  };

  const handleHide = (id: string) => {
    setHiddenIds(prev => new Set([...prev, id]));
  };

  const handleUnhide = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this annotation? It will be marked as rejected.")) return;
    setActionLoading(id);
    // Use admin API to update status
    try {
      const res = await fetch(`${AGENTATION_API}/api/admin/annotations/${id}?adminToken=${editToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", reviewNote: "Cancelled by user" }),
      });
      if (res.ok) {
        await loadAnnotations();
      }
    } catch (err) {
      console.error(err);
    }
    setActionLoading(null);
  };

  // Filter logic
  const filteredAnnotations = annotations.filter((a) => {
    // Handle hidden items
    const isHidden = hiddenIds.has(a.id);
    if (showHidden) {
      return isHidden; // Show only hidden
    }
    if (isHidden) return false; // Hide hidden items

    // Status-based filters
    if (filter === "active") {
      // Show pending, processing, implemented, revision_requested
      return ["pending", "processing", "implemented", "revision_requested"].includes(a.status);
    }
    if (filter === "review") {
      return a.status === "implemented";
    }
    if (filter === "mine") {
      return a.isOwn;
    }
    return true; // "all"
  });

  const reviewCount = annotations.filter((a) => a.status === "implemented" && !hiddenIds.has(a.id)).length;
  const activeCount = annotations.filter((a) => 
    ["pending", "processing", "implemented", "revision_requested"].includes(a.status) && !hiddenIds.has(a.id)
  ).length;

  // Determine which buttons to show based on status and ownership
  const getActions = (a: AnnotationSummary) => {
    const isOwn = a.isOwn;
    const isAdmin = tokenInfo.isAdmin;
    const canManage = isOwn || isAdmin;

    switch (a.status) {
      case "pending":
        return canManage ? ["cancel", "hide"] : ["hide"];
      case "processing":
        return ["hide"]; // Can't do much while processing
      case "implemented":
        return canManage ? ["approve", "edit", "reject"] : ["hide"];
      case "approved":
      case "completed":
      case "rejected":
      case "failed":
      case "interrupted":
        return ["hide"];
      case "revision_requested":
        return ["hide"];
      default:
        return ["hide"];
    }
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-600 rounded-full shadow-lg backdrop-blur-sm transition-all"
      >
        <span className="text-sm font-medium text-white">
          {isOpen ? "Close" : "Review"}
        </span>
        {activeCount > 0 && (
          <span className={`flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold text-white rounded-full ${reviewCount > 0 ? 'bg-purple-500' : 'bg-slate-600'}`}>
            {activeCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-32 right-4 z-50 w-96 max-h-[70vh] bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl backdrop-blur-sm overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">Annotations</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className={`p-1.5 transition-colors ${showHidden ? 'text-purple-400' : 'text-slate-400 hover:text-white'}`}
                  title={showHidden ? "Show active" : "Show hidden"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {showHidden ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    )}
                  </svg>
                </button>
                <button
                  onClick={loadAnnotations}
                  disabled={isLoading}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors"
                >
                  <svg className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Filters */}
            {!showHidden && (
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: "active", label: `Active (${activeCount})` },
                  { key: "review", label: `Review (${reviewCount})`, highlight: reviewCount > 0 },
                  { key: "mine", label: "Mine" },
                  { key: "all", label: "All" },
                ].map(({ key, label, highlight }) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key as typeof filter)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      filter === key
                        ? highlight ? "bg-purple-500 text-white" : "bg-slate-600 text-white"
                        : highlight ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30" : "bg-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {showHidden && (
              <p className="text-xs text-slate-500">Showing {hiddenIds.size} hidden annotation(s)</p>
            )}
          </div>

          {/* Annotation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredAnnotations.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {isLoading ? "Loading..." : showHidden ? "No hidden annotations" : "No annotations"}
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredAnnotations.map((a) => {
                  const actions = getActions(a);
                  const isHidden = hiddenIds.has(a.id);
                  
                  return (
                    <div key={a.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={a.status} />
                          <span className="text-xs text-slate-500">
                            <TimeAgo timestamp={a.timestamp} />
                          </span>
                        </div>
                        <span className={`text-xs ${a.isOwn ? "text-cyan-400" : "text-slate-500"}`}>
                          {a.tokenOwner}
                        </span>
                      </div>

                      {/* Comment */}
                      <p className="text-sm text-slate-300 mb-2 line-clamp-2">
                        {a.comment}
                      </p>

                      {/* Element target */}
                      <p className="text-xs text-slate-500 mb-3 font-mono truncate">
                        {a.element}
                      </p>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {isHidden ? (
                          <button
                            onClick={() => handleUnhide(a.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                          >
                            Unhide
                          </button>
                        ) : (
                          <>
                            {actions.includes("approve") && (
                              <button
                                onClick={() => handleApprove(a.id)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {actionLoading === a.id ? "..." : "✓ Approve"}
                              </button>
                            )}
                            {actions.includes("edit") && (
                              <button
                                onClick={() => setRevisionTarget(a)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg transition-colors disabled:opacity-50"
                              >
                                ✎ Edit
                              </button>
                            )}
                            {actions.includes("reject") && (
                              <button
                                onClick={() => handleReject(a.id)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                              >
                                ✕ Reject
                              </button>
                            )}
                            {actions.includes("cancel") && (
                              <button
                                onClick={() => handleCancel(a.id)}
                                disabled={actionLoading === a.id}
                                className="px-3 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            )}
                            {actions.includes("hide") && (
                              <button
                                onClick={() => handleHide(a.id)}
                                className="px-3 py-1.5 text-xs font-medium bg-slate-700/50 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors"
                              >
                                Hide
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      {/* Commit info */}
                      {a.commitSha && (
                        <p className="text-xs text-slate-600 mt-2 font-mono">
                          commit: {a.commitSha.slice(0, 7)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-slate-700 bg-slate-800/50">
            <p className="text-xs text-slate-500 text-center">
              Logged in as <span className="text-cyan-400">{tokenInfo.name}</span>
              {tokenInfo.isAdmin && <span className="text-yellow-400 ml-1">(admin)</span>}
            </p>
          </div>
        </div>
      )}

      {/* Revision modal */}
      {revisionTarget && (
        <RevisionModal
          annotation={revisionTarget}
          onSubmit={handleRevisionSubmit}
          onCancel={() => setRevisionTarget(null)}
          isLoading={actionLoading === revisionTarget.id}
        />
      )}
    </>
  );
}
