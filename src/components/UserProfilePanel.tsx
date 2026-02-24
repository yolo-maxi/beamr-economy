import { useState } from "react";
import { createPortal } from "react-dom";
import { shortenAddress, formatCompactFlowRate } from "../lib/utils";
import ShareCard from "./ShareCard";
import type { Edge, Node } from "reactflow";

type PoolInfo = {
  address: string;
  totalUnits?: string;
  flowRate?: string;
  flowRateLabel?: string;
  perUnitFlowRateLabel?: string;
  memberCount?: number;
};

type FlowStats = {
  totalFlowRate: bigint;
  userCount: number;
};

type UserData = {
  address: string;
  label: string;
  farcaster?: string;
  avatarUrl?: string;
  distributedPools?: PoolInfo[];
  incomingFlows?: FlowStats;
  outgoingFlows?: FlowStats;
};

type StreamInfo = {
  userId: string;
  label: string;
  avatarUrl?: string;
  flowRate: bigint;
  units?: string;
  weight?: number; // Percentage of total
};

type UserProfilePanelProps = {
  selectedNodeId: string | null;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
};

export default function UserProfilePanel({
  selectedNodeId,
  nodes,
  edges,
  onClose,
}: UserProfilePanelProps) {
  const [showIncoming, setShowIncoming] = useState(false); // Collapsed by default
  const [showOutgoing, setShowOutgoing] = useState(false); // Collapsed by default
  const [showShareCard, setShowShareCard] = useState(false);

  if (!selectedNodeId) return null;

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode || selectedNode.type !== "user") return null;

  const userData = selectedNode.data as UserData;

  // Build incoming streams (edges where this user is the target)
  const incomingStreams: StreamInfo[] = edges
    .filter((e) => e.target === selectedNodeId)
    .map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const sourceData = sourceNode?.data as UserData | undefined;
      const flowRate = BigInt(edge.data?.flowRate ?? "0");
      return {
        userId: edge.source,
        label: sourceData?.label ?? shortenAddress(edge.source.replace("account:", "")),
        avatarUrl: sourceData?.avatarUrl,
        flowRate,
        units: edge.data?.units,
      };
    })
    .sort((a, b) => (b.flowRate > a.flowRate ? 1 : -1));

  // Calculate weights for incoming
  const totalIncoming = incomingStreams.reduce((sum, s) => sum + s.flowRate, 0n);
  incomingStreams.forEach((s) => {
    s.weight = totalIncoming > 0n ? Number((s.flowRate * 10000n) / totalIncoming) / 100 : 0;
  });

  // Build outgoing streams (edges where this user is the source)
  const outgoingStreams: StreamInfo[] = edges
    .filter((e) => e.source === selectedNodeId)
    .map((edge) => {
      const targetNode = nodes.find((n) => n.id === edge.target);
      const targetData = targetNode?.data as UserData | undefined;
      const flowRate = BigInt(edge.data?.flowRate ?? "0");
      return {
        userId: edge.target,
        label: targetData?.label ?? shortenAddress(edge.target.replace("account:", "")),
        avatarUrl: targetData?.avatarUrl,
        flowRate,
        units: edge.data?.units,
      };
    })
    .sort((a, b) => (b.flowRate > a.flowRate ? 1 : -1));

  // Calculate weights for outgoing
  const totalOutgoing = outgoingStreams.reduce((sum, s) => sum + s.flowRate, 0n);
  outgoingStreams.forEach((s) => {
    s.weight = totalOutgoing > 0n ? Number((s.flowRate * 10000n) / totalOutgoing) / 100 : 0;
  });

  return (
    <div className="fixed right-4 top-4 z-50 w-80 max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-900/95 shadow-xl shadow-cyan-500/10 ring-1 ring-cyan-400/20 backdrop-blur-sm sm:right-6 sm:top-6">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-700/50 px-4 py-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400/40 bg-slate-800">
          {userData.avatarUrl ? (
            <img
              src={userData.avatarUrl}
              alt={userData.label}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-lg font-bold text-slate-400">
              {userData.label.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">
              {userData.label}
            </h3>
            {userData.farcaster && !userData.label.includes(userData.farcaster) && (
              <a
                href={`https://farcaster.xyz/${userData.farcaster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1"
                title="View on Farcaster"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.24 1H5.76A4.76 4.76 0 001 5.76v12.48A4.76 4.76 0 005.76 23h12.48A4.76 4.76 0 0023 18.24V5.76A4.76 4.76 0 0018.24 1zM12 17.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/>
                </svg>
                @{userData.farcaster}
              </a>
            )}
          </div>
          <a
            href={`https://basescan.org/address/${userData.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-cyan-400"
          >
            {shortenAddress(userData.address)}
          </a>
        </div>
        <button
          onClick={() => setShowShareCard(true)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-400"
          title="Share card"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Flow Summary */}
      <div className="flex border-b border-slate-700/50">
        {userData.incomingFlows && userData.incomingFlows.userCount > 0 && (
          <div className="flex-1 px-4 py-2 text-center border-r border-slate-700/50">
            <div className="text-xs text-slate-400">Receiving</div>
            <div className="text-sm font-semibold text-emerald-400">
              {formatCompactFlowRate(userData.incomingFlows.totalFlowRate)}/day
            </div>
            <div className="text-[10px] text-slate-500">
              from {userData.incomingFlows.userCount} user{userData.incomingFlows.userCount !== 1 ? "s" : ""}
            </div>
          </div>
        )}
        {userData.outgoingFlows && userData.outgoingFlows.userCount > 0 && (
          <div className="flex-1 px-4 py-2 text-center">
            <div className="text-xs text-slate-400">Sending</div>
            <div className="text-sm font-semibold text-red-400">
              {formatCompactFlowRate(userData.outgoingFlows.totalFlowRate)}/day
            </div>
            <div className="text-[10px] text-slate-500">
              to {userData.outgoingFlows.userCount} user{userData.outgoingFlows.userCount !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>

      {/* Streams List */}
      <div className="overflow-y-auto max-h-[calc(100vh-16rem)]">
        {/* Incoming Streams - Top Contributors */}
        {incomingStreams.length > 0 && (
          <div className="border-b border-slate-700/50">
            <button
              onClick={() => setShowIncoming(!showIncoming)}
              className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-800/50"
            >
              <span className="text-xs font-medium text-emerald-400">
                ↓ Top Contributors ({incomingStreams.length})
              </span>
              <svg
                className={`h-3 w-3 text-slate-400 transition-transform ${showIncoming ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showIncoming && (
              <div className="max-h-40 overflow-y-auto px-2 pb-2">
                {incomingStreams.map((stream) => (
                  <StreamRow key={stream.userId} stream={stream} type="incoming" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Outgoing Streams - Top Recipients */}
        {outgoingStreams.length > 0 && (
          <div>
            <button
              onClick={() => setShowOutgoing(!showOutgoing)}
              className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-800/50"
            >
              <span className="text-xs font-medium text-red-400">
                ↑ Top Recipients ({outgoingStreams.length})
              </span>
              <svg
                className={`h-3 w-3 text-slate-400 transition-transform ${showOutgoing ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showOutgoing && (
              <div className="max-h-40 overflow-y-auto px-2 pb-2">
                {outgoingStreams.map((stream) => (
                  <StreamRow key={stream.userId} stream={stream} type="outgoing" />
                ))}
              </div>
            )}
          </div>
        )}

        {incomingStreams.length === 0 && outgoingStreams.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            No active streams
          </div>
        )}
      </div>

      {/* Big Share on Farcaster CTA */}
      <div className="border-t border-slate-700/50 px-4 py-3">
        <button
          onClick={() => setShowShareCard(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #8B5CF6, #7C3AED)",
            boxShadow: "0 4px 20px rgba(124, 58, 237, 0.4)",
          }}
        >
          {/* Farcaster icon */}
          <svg
            className="h-4 w-4"
            viewBox="0 0 1000 1000"
            fill="currentColor"
          >
            <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
            <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
            <path d="M693.333 746.667C681.06 746.667 671.111 756.616 671.111 768.889V795.556H666.667C654.394 795.556 644.444 805.505 644.444 817.778V844.444H893.333V817.778C893.333 805.505 883.384 795.556 871.111 795.556H866.667V768.889C866.667 756.616 856.717 746.667 844.444 746.667V351.111H868.889L897.778 253.333H720V746.667H693.333Z" />
          </svg>
          Share on Farcaster
        </button>
      </div>

      {/* Share Card Modal — portalled to body to escape overflow-hidden */}
      {showShareCard &&
        createPortal(
          <ShareCard
            selectedNodeId={selectedNodeId}
            nodes={nodes}
            edges={edges}
            onClose={() => setShowShareCard(false)}
          />,
          document.body
        )}
    </div>
  );
}

function StreamRow({ stream, type }: { stream: StreamInfo; type: "incoming" | "outgoing" }) {
  const colorClass = type === "incoming" ? "text-emerald-400" : "text-red-400";
  const bgClass = type === "incoming" ? "bg-emerald-500/20" : "bg-red-500/20";

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/50">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800">
        {stream.avatarUrl ? (
          <img
            src={stream.avatarUrl}
            alt={stream.label}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[8px] font-medium text-slate-400">
            {stream.label.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-slate-300">{stream.label}</div>
      </div>
      {/* Show % prominently */}
      {stream.weight !== undefined && stream.weight > 0 && (
        <div className={`rounded-md px-2 py-0.5 text-xs font-semibold ${bgClass} ${colorClass}`}>
          {stream.weight.toFixed(1)}%
        </div>
      )}
    </div>
  );
}
