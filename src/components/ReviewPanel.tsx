import { useState, useEffect, useCallback } from "react";
import {
  fetchAnnotations,
  approveAnnotation,
  rejectAnnotation,
  reviseAnnotation,
  type AnnotationSummary,
  type TokenValidation,
  AGENTATION_API,
} from "../lib/agentation";

interface ReviewPanelProps {
  editToken: string;
  tokenInfo: TokenValidation;
  onRefresh?: () => void;
}

// Map statuses to display config - light mode colors
const STATUS_CONFIG: Record<string, { label: string; lightColor: string; darkColor: string; lightBg: string; darkBg: string; icon: string }> = {
  pending: { label: "Pending", lightColor: "text-amber-600", darkColor: "text-yellow-400", lightBg: "bg-amber-100", darkBg: "bg-yellow-400/20", icon: "⏳" },
  processing: { label: "Processing", lightColor: "text-blue-600", darkColor: "text-blue-400", lightBg: "bg-blue-100", darkBg: "bg-blue-400/20", icon: "⚙️" },
  implemented: { label: "Review", lightColor: "text-purple-600", darkColor: "text-purple-400", lightBg: "bg-purple-100", darkBg: "bg-purple-400/20", icon: "👀" },
  approved: { label: "Approved", lightColor: "text-green-600", darkColor: "text-green-400", lightBg: "bg-green-100", darkBg: "bg-green-400/20", icon: "✅" },
  completed: { label: "Done", lightColor: "text-green-600", darkColor: "text-green-400", lightBg: "bg-green-100", darkBg: "bg-green-400/20", icon: "✅" },
  rejected: { label: "Rejected", lightColor: "text-red-600", darkColor: "text-red-400", lightBg: "bg-red-100", darkBg: "bg-red-400/20", icon: "❌" },
  revision_requested: { label: "Revising", lightColor: "text-orange-600", darkColor: "text-orange-400", lightBg: "bg-orange-100", darkBg: "bg-orange-400/20", icon: "🔄" },
  failed: { label: "Failed", lightColor: "text-red-700", darkColor: "text-red-500", lightBg: "bg-red-100", darkBg: "bg-red-500/20", icon: "💥" },
  interrupted: { label: "Interrupted", lightColor: "text-gray-600", darkColor: "text-gray-400", lightBg: "bg-gray-100", darkBg: "bg-gray-400/20", icon: "⏸️" },
  archived: { label: "Archived", lightColor: "text-gray-500", darkColor: "text-gray-500", lightBg: "bg-gray-100", darkBg: "bg-gray-500/20", icon: "📦" },
};

function StatusBadge({ status, isDark }: { status: string; isDark: boolean }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const color = isDark ? config.darkColor : config.lightColor;
  const bg = isDark ? config.darkBg : config.lightBg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${bg} ${color}`}>
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
  isDark: boolean;
}

function RevisionModal({ annotation, onSubmit, onCancel, isLoading, isDark }: RevisionModalProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={`w-full max-w-lg mx-4 rounded-xl border shadow-2xl ${
        isDark 
          ? "bg-slate-900 border-slate-700" 
          : "bg-white border-gray-200"
      }`}>
        <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Request Revision</h3>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Describe what changes you want to the current implementation
          </p>
        </div>
        
        <div className="p-4">
          <div className={`mb-4 p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
            <p className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Original request:</p>
            <p className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>{annotation.comment}</p>
          </div>
          
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Make the color darker, move it to the left, add more padding..."
            className={`w-full h-32 px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
              isDark 
                ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" 
                : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
            }`}
            autoFocus
          />
          
          {annotation.revisionCount > 0 && (
            <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              This annotation has been revised {annotation.revisionCount} time(s)
            </p>
          )}
        </div>
        
        <div className={`p-4 border-t flex justify-end gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              isDark ? "text-slate-300 hover:text-white" : "text-gray-600 hover:text-gray-900"
            }`}
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
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('review_panel_dark');
    return saved ? JSON.parse(saved) : false; // Light mode by default
  });
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

  // Save theme preference
  useEffect(() => {
    localStorage.setItem('review_panel_dark', JSON.stringify(isDark));
  }, [isDark]);

  // Save hidden IDs to localStorage
  useEffect(() => {
    localStorage.setItem('hidden_annotations', JSON.stringify([...hiddenIds]));
  }, [hiddenIds]);

  const loadAnnotations = useCallback(async () => {
    setIsLoading(true);
    const data = await fetchAnnotations(editToken, true);
    data.sort((a, b) => b.timestamp - a.timestamp);
    setAnnotations(data);
    setIsLoading(false);
  }, [editToken]);

  useEffect(() => {
    if (isOpen) {
      loadAnnotations();
    }
  }, [isOpen, loadAnnotations]);

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

  const filteredAnnotations = annotations.filter((a) => {
    const isHidden = hiddenIds.has(a.id);
    if (showHidden) return isHidden;
    if (isHidden) return false;
    if (filter === "active") {
      return ["pending", "processing", "implemented", "revision_requested"].includes(a.status);
    }
    if (filter === "review") return a.status === "implemented";
    if (filter === "mine") return a.isOwn;
    return true;
  });

  const reviewCount = annotations.filter((a) => a.status === "implemented" && !hiddenIds.has(a.id)).length;
  const activeCount = annotations.filter((a) => 
    ["pending", "processing", "implemented", "revision_requested"].includes(a.status) && !hiddenIds.has(a.id)
  ).length;

  const getActions = (a: AnnotationSummary) => {
    const isOwn = a.isOwn;
    const isAdmin = tokenInfo.isAdmin;
    const canManage = isOwn || isAdmin;

    switch (a.status) {
      case "pending": return canManage ? ["cancel", "hide"] : ["hide"];
      case "processing": return ["hide"];
      case "implemented": return canManage ? ["approve", "edit", "reject"] : ["hide"];
      case "approved":
      case "completed":
      case "rejected":
      case "failed":
      case "interrupted": return ["hide"];
      case "revision_requested": return ["hide"];
      default: return ["hide"];
    }
  };

  // Theme-aware styles
  const panelBg = isDark ? "bg-slate-900/95" : "bg-white/95";
  const panelBorder = isDark ? "border-slate-700" : "border-gray-200";
  const headerBorder = isDark ? "border-slate-700" : "border-gray-200";
  const textPrimary = isDark ? "text-white" : "text-gray-900";
  const textSecondary = isDark ? "text-slate-400" : "text-gray-500";
  const textMuted = isDark ? "text-slate-500" : "text-gray-400";
  const hoverBg = isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50";
  const dividerBg = isDark ? "divide-slate-800" : "divide-gray-100";
  const footerBg = isDark ? "bg-slate-800/50" : "bg-gray-50";
  const buttonBg = isDark ? "bg-slate-700/50 hover:bg-slate-700" : "bg-gray-100 hover:bg-gray-200";
  const buttonText = isDark ? "text-slate-300" : "text-gray-600";

  return (
    <>
      {/* Button injected into toolbar area - positioned to appear as part of the toolbar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-5 right-[calc(1.25rem+260px)] z-[100001] w-[34px] h-[34px] flex items-center justify-center rounded-full transition-all duration-150 ${
          isDark 
            ? "bg-transparent hover:bg-white/10 text-white/80 hover:text-white" 
            : "bg-transparent hover:bg-black/5 text-black/60 hover:text-black/90"
        } ${isOpen ? "text-purple-500" : ""}`}
        title={isOpen ? "Close review panel" : "Open review panel"}
      >
        <span className="text-base">{isOpen ? "✕" : (reviewCount > 0 ? "👀" : "📋")}</span>
        {activeCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold text-white rounded-full bg-purple-500">
            {activeCount}
          </span>
        )}
      </button>

      {/* Panel - appears above the toolbar */}
      {isOpen && (
        <div className={`fixed bottom-16 right-5 z-[100003] w-96 max-h-[60vh] ${panelBg} border ${panelBorder} rounded-xl shadow-2xl backdrop-blur-sm overflow-hidden flex flex-col`}>
          {/* Header */}
          <div className={`p-4 border-b ${headerBorder}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Annotations</h2>
              <div className="flex items-center gap-2">
                {/* Theme toggle */}
                <button
                  onClick={() => setIsDark(!isDark)}
                  className={`p-1.5 transition-colors rounded ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
                  title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {isDark ? "☀️" : "🌙"}
                </button>
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className={`p-1.5 transition-colors ${showHidden ? 'text-purple-400' : isDark ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
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
                  className={`p-1.5 transition-colors ${isDark ? 'text-slate-400 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
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
                        ? highlight ? "bg-purple-500 text-white" : isDark ? "bg-slate-600 text-white" : "bg-gray-200 text-gray-900"
                        : highlight 
                          ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" 
                          : isDark 
                            ? "bg-slate-800 text-slate-400 hover:text-white" 
                            : "bg-gray-100 text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {showHidden && (
              <p className={`text-xs ${textMuted}`}>Showing {hiddenIds.size} hidden annotation(s)</p>
            )}
          </div>

          {/* Annotation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredAnnotations.length === 0 ? (
              <div className={`p-8 text-center ${textSecondary}`}>
                {isLoading ? "Loading..." : showHidden ? "No hidden annotations" : "No annotations"}
              </div>
            ) : (
              <div className={`divide-y ${dividerBg}`}>
                {filteredAnnotations.map((a) => {
                  const actions = getActions(a);
                  const isHidden = hiddenIds.has(a.id);
                  
                  return (
                    <div key={a.id} className={`p-4 transition-colors ${hoverBg}`}>
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={a.status} isDark={isDark} />
                          <span className={`text-xs ${textMuted}`}>
                            <TimeAgo timestamp={a.timestamp} />
                          </span>
                        </div>
                        <span className={`text-xs ${a.isOwn ? "text-cyan-500" : textMuted}`}>
                          {a.tokenOwner}
                        </span>
                      </div>

                      {/* Comment */}
                      <p className={`text-sm mb-2 line-clamp-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        {a.comment}
                      </p>

                      {/* Element target */}
                      <p className={`text-xs mb-3 font-mono truncate ${textMuted}`}>
                        {a.element}
                      </p>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {isHidden ? (
                          <button
                            onClick={() => handleUnhide(a.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${buttonBg} ${buttonText}`}
                          >
                            Unhide
                          </button>
                        ) : (
                          <>
                            {actions.includes("approve") && (
                              <button
                                onClick={() => handleApprove(a.id)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600/20 hover:bg-green-600/30 text-green-500 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {actionLoading === a.id ? "..." : "✓ Approve"}
                              </button>
                            )}
                            {actions.includes("edit") && (
                              <button
                                onClick={() => setRevisionTarget(a)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-purple-600/20 hover:bg-purple-600/30 text-purple-500 rounded-lg transition-colors disabled:opacity-50"
                              >
                                ✎ Edit
                              </button>
                            )}
                            {actions.includes("reject") && (
                              <button
                                onClick={() => handleReject(a.id)}
                                disabled={actionLoading === a.id}
                                className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg transition-colors disabled:opacity-50"
                              >
                                ✕ Reject
                              </button>
                            )}
                            {actions.includes("cancel") && (
                              <button
                                onClick={() => handleCancel(a.id)}
                                disabled={actionLoading === a.id}
                                className="px-3 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg transition-colors disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            )}
                            {actions.includes("hide") && (
                              <button
                                onClick={() => handleHide(a.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${buttonBg} ${buttonText}`}
                              >
                                Hide
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      {/* Commit info */}
                      {a.commitSha && (
                        <p className={`text-xs mt-2 font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
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
          <div className={`p-3 border-t ${headerBorder} ${footerBg}`}>
            <p className={`text-xs text-center ${textMuted}`}>
              Logged in as <span className="text-cyan-500">{tokenInfo.name}</span>
              {tokenInfo.isAdmin && <span className="text-yellow-500 ml-1">(admin)</span>}
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
          isDark={isDark}
        />
      )}
    </>
  );
}
