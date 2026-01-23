import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  Handle,
  MiniMap,
  Panel,
  Position,
  applyNodeChanges,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeChange,
} from "reactflow";
import { buildGraphElements } from "../lib/graph";
import {
  type BeamrConfig,
  type BeamrData,
  fetchBeamrData,
  readBeamrConfig,
  saveBeamrConfig,
} from "../lib/superfluid";
import { preloadImage } from "../lib/imageCache";
import { shortenAddress, formatCompactFlowRate, saveNodePositions } from "../lib/utils";
import {
  loadCachedBeamrData,
  saveBeamrData,
  mergeBeamrData,
  hasBeamrDataChanges,
} from "../lib/dataCache";

const POLL_INTERVAL_MS = 60_000;
const NODE_TYPES = {
  user: UserNode,
};

export default function FlowGraph() {
  const [config, setConfig] = useState<BeamrConfig>(() => readBeamrConfig());
  const [draftConfig, setDraftConfig] = useState<BeamrConfig>(() =>
    readBeamrConfig()
  );
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentData, setCurrentData] = useState<BeamrData | null>(null);
  const [nodesDraggable, setNodesDraggable] = useState(true);

  // Load cached data immediately on mount and when config changes
  useEffect(() => {
    const cached = loadCachedBeamrData(config);
    if (cached) {
      setCurrentData(cached);
      buildGraphElements(cached).then((graph) => {
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setIsInitialLoad(false);
      });
    } else {
      // Config changed or no cache - clear data and wait for fetch
      setCurrentData(null);
      setNodes([]);
      setEdges([]);
      setIsInitialLoad(false);
    }
  }, [config]);

  // Update graph when currentData changes
  useEffect(() => {
    if (!currentData) return;
    buildGraphElements(currentData).then((graph) => {
      setNodes(graph.nodes);
      setEdges(graph.edges);
    });
  }, [currentData]);

  // Fetch and merge new data periodically and on config change
  useEffect(() => {
    let mounted = true;

    const fetchAndMerge = async () => {
      setError(null);

      try {
        const newData = await fetchBeamrData(config);
        if (!mounted) return;

        setCurrentData((prev) => {
          // If config changed, prev might be from old config, so start fresh
          if (!prev) {
            // No existing data, use new data
            saveBeamrData(newData, config);
            return newData;
          }

          // Check if there are changes
          if (hasBeamrDataChanges(prev, newData)) {
            // Merge new data into existing
            const merged = mergeBeamrData(prev, newData);
            saveBeamrData(merged, config);
            return merged;
          }

          // No changes, keep existing data
          return prev;
        });
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    };

    // Fetch immediately on config change (but don't show loading)
    fetchAndMerge();
    const interval = setInterval(fetchAndMerge, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [config]);

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);


  const handleSaveConfig = () => {
    const cleaned = {
      subgraphUrl: draftConfig.subgraphUrl.trim(),
      tokenAddress: draftConfig.tokenAddress.trim(),
    };
    saveBeamrConfig(cleaned);
    setConfig(cleaned);
  };

  const showEmptyState = !isInitialLoad && !error && nodes.length === 0;

  // Compute sorted users list by total outgoing flowrate
  const sortedUsers = useMemo(() => {
    return nodes
      .filter((node) => node.type === "user")
      .map((node) => {
        const data = node.data as UserNodeProps["data"];
        const totalOutgoingFlowRate =
          data.distributedPools?.reduce((sum, pool) => {
            try {
              return sum + BigInt(pool.flowRate ?? "0");
            } catch {
              return sum;
            }
          }, 0n) ?? 0n;
        return {
          id: node.id,
          label: data.label,
          address: data.address,
          avatarUrl: data.avatarUrl,
          totalOutgoingFlowRate,
          isDistributor: (data.distributedPools?.length ?? 0) > 0,
          incomingFlows: data.incomingFlows,
          outgoingFlows: data.outgoingFlows,
        };
      })
      .filter((user) => {
        // Only show users with active incoming or outgoing flows
        const hasIncoming = user.incomingFlows && user.incomingFlows.userCount > 0;
        const hasOutgoing = user.outgoingFlows && user.outgoingFlows.userCount > 0;
        return hasIncoming || hasOutgoing;
      })
      .sort((a, b) => {
        // Sort by flowrate descending (highest first)
        if (b.totalOutgoingFlowRate > a.totalOutgoingFlowRate) return 1;
        if (b.totalOutgoingFlowRate < a.totalOutgoingFlowRate) return -1;
        return 0;
      });
  }, [nodes]);

  const handleUserListClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    // Fit view to show full graph (same as box button in Controls)
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ duration: 600 });
    }
  };

  const { styledNodes, styledEdges } = useMemo(() => {
    const baseEdges = edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        opacity: 0.18,
      },
    }));

    const activeNodeId = selectedNodeId;

    if (!activeNodeId) {
      return {
        styledNodes: nodes.map((node) => ({
          ...node,
          draggable: false,
          data: { ...node.data, highlight: undefined, dimmed: false },
        })),
        styledEdges: baseEdges,
      };
    }

    const downstreamMembers = new Set<string>();
    const upstreamDistributors = new Set<string>();
    const connectedEdgeIds = new Set<string>();

    for (const edge of edges) {
      // Edges where active node is the source (distributor) -> downstream members
      if (edge.source === activeNodeId) {
        downstreamMembers.add(edge.target);
        connectedEdgeIds.add(edge.id);
      }
      // Edges where active node is the target (member) -> upstream distributors
      if (edge.target === activeNodeId) {
        upstreamDistributors.add(edge.source);
        connectedEdgeIds.add(edge.id);
      }
    }

    const styledEdges = baseEdges.map((edge) => {
      if (!connectedEdgeIds.has(edge.id)) return edge;
      const isDownstream = edge.source === activeNodeId;
      const isUpstream = edge.target === activeNodeId;
      const stroke =
        isDownstream && isUpstream
          ? "#facc15"
          : isUpstream
          ? "#22c55e"
          : "#ef4444";
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: 1,
          stroke,
          strokeWidth: Math.max((edge.style?.strokeWidth as number) ?? 1.5, 10),
        },
      };
    });

    // Track which nodes are highlighted (active node + connected nodes)
    const highlightedNodeIds = new Set<string>();
    if (activeNodeId) {
      highlightedNodeIds.add(activeNodeId);
      downstreamMembers.forEach(id => highlightedNodeIds.add(id));
      upstreamDistributors.forEach(id => highlightedNodeIds.add(id));
    }

    const styledNodes = nodes.map((node) => {
      // If this is the active node
      if (node.id === activeNodeId) {
        return { 
          ...node, 
          draggable: true,
          data: { 
            ...node.data, 
            highlight: "self",
            dimmed: false,
          } 
        };
      }
      const isDownstream = downstreamMembers.has(node.id);
      const isUpstream = upstreamDistributors.has(node.id);
      
      // In selection mode, use normal highlight types
      const highlight =
        isDownstream && isUpstream
          ? "both"
          : isDownstream
          ? "downstream"
          : isUpstream
          ? "upstream"
          : undefined;
      // Dim nodes that aren't highlighted when a node is selected
      const dimmed = selectedNodeId !== null && !highlightedNodeIds.has(node.id);
      // Only allow dragging for highlighted nodes (upstream/downstream), not dimmed ones
      const draggable = highlight !== undefined && !dimmed;
      return { ...node, draggable, data: { ...node.data, highlight, dimmed } };
    });

    return { styledNodes, styledEdges };
  }, [edges, selectedNodeId, nodes]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    if (node.type !== "user") return;
    // Only select if clicking a different node, don't unselect if clicking the same node
    if (selectedNodeId !== node.id) {
      setSelectedNodeId(node.id);
    }
  };

  const handlePaneClick = () => {
    // Clicking on empty space deselects
    setSelectedNodeId(null);
  };

  const handleNodesChange = (changes: NodeChange[]) => {
    // Apply changes to nodes and get updated nodes
    setNodes((nds) => {
      const updatedNodes = applyNodeChanges(changes, nds);
      
      // Save positions to localStorage when nodes are moved
      // Only save position changes (not other types of changes)
      const positionChanges = changes.filter(
        (change) => change.type === "position" && change.position !== undefined
      );
      
      if (positionChanges.length > 0) {
        // Build positions map from updated nodes
        const positions: Record<string, { x: number; y: number }> = {};
        for (const node of updatedNodes) {
          if (node.type === "user") {
            positions[node.id] = { x: node.position.x, y: node.position.y };
          }
        }
        saveNodePositions(positions);
      }
      
      return updatedNodes;
    });
  };


  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-slate-300">
        <div className="max-w-2xl space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold text-slate-100">
            Unable to load Superfluid data
          </h2>
          <p className="text-sm">{error}</p>
          <p className="text-xs text-slate-400">
            Set <span className="font-mono">VITE_SUPERFLUID_SUBGRAPH_URL</span> in
            your environment to point at the Superfluid subgraph for the BEAMR
            network.
          </p>
          <SettingsPanel
            config={draftConfig}
            onChange={setDraftConfig}
            onSave={handleSaveConfig}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {showEmptyState && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-8 text-center text-slate-300">
          <div className="max-w-2xl space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-slate-100">
              No pools or streams returned
            </h2>
            <p className="text-sm text-slate-300">
              Check the subgraph URL and token address, then try again.
            </p>
            <SettingsPanel
              config={draftConfig}
              onChange={setDraftConfig}
              onSave={handleSaveConfig}
            />
          </div>
        </div>
      )}
      {isInitialLoad && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 text-sm text-slate-200">
          Loading BEAMR streams and pools...
        </div>
      )}
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={NODE_TYPES}
        minZoom={0.005}
        maxZoom={2}
        className="bg-slate-950"
        nodesDraggable={nodesDraggable}
        onInit={setReactFlowInstance}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        proOptions={{ hideAttribution: true }}
      >
        <Controls>
          <ControlButton
            onClick={() => setNodesDraggable(!nodesDraggable)}
            title={nodesDraggable ? "Lock nodes" : "Unlock nodes"}
            aria-label={nodesDraggable ? "Lock nodes" : "Unlock nodes"}
          >
            {nodesDraggable ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <circle cx="12" cy="16" r="1" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </ControlButton>
        </Controls>
        <Background color="#1e293b" gap={20} />
        {/* Navigation Panel - contains user list and minimap */}
        <Panel position="bottom-right" className="!m-3 !p-0">
          <NavigationPanel
            users={sortedUsers}
            selectedNodeId={selectedNodeId}
            onUserClick={handleUserListClick}
            nodeCount={nodes.length}
            edgeCount={edges.length}
          />
        </Panel>
      </ReactFlow>
    </div>
  );
}

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

type UserNodeProps = {
  data: {
    address: string;
    label: string;
    farcaster?: string;
    avatarUrl?: string;
    highlight?: "upstream" | "downstream" | "both" | "self" | "selected-inactive" | "hover-self" | "hover-upstream" | "hover-downstream" | "hover-both";
    dimmed?: boolean;
    distributedPools?: PoolInfo[];
    incomingFlows?: FlowStats;
    outgoingFlows?: FlowStats;
  };
};

/** Compact flow stats display with colored arrows: #users <arrow> $flowrate */
function FlowStatsDisplay({ incoming, outgoing, compact = false }: {
  incoming?: FlowStats;
  outgoing?: FlowStats;
  compact?: boolean;
}) {
  const incomingRate = incoming?.totalFlowRate ? formatCompactFlowRate(incoming.totalFlowRate) : null;
  const outgoingRate = outgoing?.totalFlowRate ? formatCompactFlowRate(outgoing.totalFlowRate) : null;
  
  if (!incomingRate && !outgoingRate) return null;
  
  return (
    <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
      {/* Incoming: #users ↓ flowrate (green) */}
      {incomingRate && (
        <div className="flex items-center gap-1" title={`Receiving ${incomingRate}/day from ${incoming!.userCount} user${incoming!.userCount !== 1 ? "s" : ""}`}>
          <span className={`text-emerald-400/70 ${compact ? "text-[8px]" : "text-[10px]"}`}>{incoming!.userCount}</span>
          <span className="text-emerald-400">↓</span>
          <span className={`font-semibold text-emerald-300 ${compact ? "text-[9px]" : "text-xs"}`}>{incomingRate}</span>
        </div>
      )}
      {/* Outgoing: #users ↑ flowrate (red) */}
      {outgoingRate && (
        <div className="flex items-center gap-1" title={`Sending ${outgoingRate}/day to ${outgoing!.userCount} user${outgoing!.userCount !== 1 ? "s" : ""}`}>
          <span className={`text-red-400/70 ${compact ? "text-[8px]" : "text-[10px]"}`}>{outgoing!.userCount}</span>
          <span className="text-red-400">↑</span>
          <span className={`font-semibold text-red-300 ${compact ? "text-[9px]" : "text-xs"}`}>{outgoingRate}</span>
        </div>
      )}
    </div>
  );
}

/** Compact stats showing only user counts with arrows - tabular layout for alignment */
function CompactUserCounts({ incoming, outgoing }: {
  incoming?: FlowStats;
  outgoing?: FlowStats;
}) {
  const hasIncoming = incoming && incoming.userCount > 0;
  const hasOutgoing = outgoing && outgoing.userCount > 0;
  
  if (!hasIncoming && !hasOutgoing) return null;
  
  // Arrow to the RIGHT of number so arrows align vertically regardless of digit count
  // Format: "11↓ 8↑" instead of "↓11 ↑8"
  return (
    <div className="flex items-center text-[9px] tabular-nums">
      {/* Incoming column: number then arrow */}
      <span 
        className="flex w-[28px] items-center justify-end"
        title={hasIncoming ? `Receiving from ${incoming.userCount} user${incoming.userCount !== 1 ? "s" : ""}` : undefined}
      >
        {hasIncoming && (
          <>
            <span className="text-emerald-400/80">{incoming.userCount}</span>
            <span className="text-emerald-400">↓</span>
          </>
        )}
      </span>
      {/* Outgoing column: number then arrow */}
      <span 
        className="flex w-[28px] items-center justify-end"
        title={hasOutgoing ? `Sending to ${outgoing.userCount} user${outgoing.userCount !== 1 ? "s" : ""}` : undefined}
      >
        {hasOutgoing && (
          <>
            <span className="text-red-400/80">{outgoing.userCount}</span>
            <span className="text-red-400">↑</span>
          </>
        )}
      </span>
    </div>
  );
}

function UserNode({ data }: UserNodeProps) {
  useEffect(() => {
    void preloadImage(data.avatarUrl);
  }, [data.avatarUrl]);

  // Build highlight styles based on relationship to selected node
  // - Outer glow in the highlight color
  // - Solid dark background (slate-950) for all highlighted states
  // - Gradient only on border+shadow for "both" case
  const getHighlightStyles = () => {
    switch (data.highlight) {
      case "self":
        // Selected node: thick white border with strong outer glow
        return {
          className: "ring-4 ring-white shadow-[0_0_60px_rgba(255,255,255,0.9),0_0_120px_rgba(255,255,255,0.5)]",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950",
        };
      case "upstream":
        // Node sending TO selected: green border with green outer glow
        return {
          className: "ring-4 ring-emerald-400 shadow-[0_0_50px_rgba(34,197,94,1),0_0_100px_rgba(34,197,94,0.6)]",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950",
        };
      case "downstream":
        // Node receiving FROM selected: red border with red outer glow
        return {
          className: "ring-4 ring-red-400 shadow-[0_0_50px_rgba(239,68,68,1),0_0_100px_rgba(239,68,68,0.6)]",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950",
        };
      case "both":
        // Node both sending and receiving: gradient border + animated pulsing glow (green ↔ red)
        return {
          className: "animate-bidirectional-glow",
          borderGradient: true,
          borderOverride: true,
          bgOverride: "bg-slate-950",
        };
      case "selected-inactive":
        return {
          className: "ring-1 ring-slate-500/50 opacity-50",
          borderGradient: false,
          borderOverride: false,
          bgOverride: undefined,
        };
      case "hover-self":
        // Hovered node: white border with softer outer glow
        return {
          className: "ring-2 ring-white/70 shadow-[0_0_40px_rgba(255,255,255,0.5),0_0_80px_rgba(255,255,255,0.3)] opacity-90",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950/90",
        };
      case "hover-upstream":
        // Node sending TO hovered: green border with softer outer glow
        return {
          className: "ring-2 ring-emerald-400/70 shadow-[0_0_30px_rgba(34,197,94,0.6),0_0_60px_rgba(34,197,94,0.4)] opacity-80",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950/80",
        };
      case "hover-downstream":
        // Node receiving FROM hovered: red border with softer outer glow
        return {
          className: "ring-2 ring-red-400/70 shadow-[0_0_30px_rgba(239,68,68,0.6),0_0_60px_rgba(239,68,68,0.4)] opacity-80",
          borderGradient: false,
          borderOverride: true,
          bgOverride: "bg-slate-950/80",
        };
      case "hover-both":
        // Node both sending and receiving to hovered: gradient border with animated pulsing glow
        return {
          className: "animate-bidirectional-glow-hover opacity-80",
          borderGradient: true,
          borderOverride: true,
          bgOverride: "bg-slate-950/80",
        };
      default:
        return {
          className: "",
          borderGradient: false,
          borderOverride: false,
          bgOverride: undefined,
        };
    }
  };

  const highlightStyles = getHighlightStyles();
  const isDistributor = data.distributedPools && data.distributedPools.length > 0;

  // Distributors (senders) get a bigger, more prominent card
  if (isDistributor) {
    const cardInner = (
      <div
        className={`min-w-[260px] rounded-2xl border-2 ${
          highlightStyles.borderGradient
            ? "border-transparent"
            : highlightStyles.borderOverride
            ? "border-transparent"
            : "border-sky-400/80"
        } ${
          highlightStyles.bgOverride
            ? highlightStyles.bgOverride
            : "bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40"
        } px-5 py-4 text-xs ${
          highlightStyles.borderOverride ? "" : "shadow-xl shadow-sky-500/30"
        } ${highlightStyles.className} ${data.dimmed ? "opacity-70" : ""}`}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-sky-400/60 bg-slate-800 text-sm text-slate-400 shadow-lg shadow-sky-500/20">
            {data.avatarUrl ? (
              <img
                src={data.avatarUrl}
                alt={data.label}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="text-base font-bold">{data.label.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-lg font-bold text-slate-100">
              {data.label}
            </div>
            <div className="text-[11px] text-sky-200/70">
              {shortenAddress(data.address)}
            </div>
          </div>
        </div>
        {/* Compact flow stats */}
        <div className="mt-3 flex items-center justify-center rounded-lg bg-slate-800/60 px-3 py-2">
          <FlowStatsDisplay incoming={data.incomingFlows} outgoing={data.outgoingFlows} />
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );

    // If "both" highlight, wrap with gradient border container
    if (highlightStyles.borderGradient) {
      return (
        <div className="flex flex-col">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-400 via-yellow-400 to-red-400 p-[3px]">
            {cardInner}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        {cardInner}
      </div>
    );
  }

  // Regular users (receivers) get a smaller, simpler card
  const hasFlowStats = data.incomingFlows || data.outgoingFlows;
  const regularCardInner = (
    <div
      className={`min-w-[180px] rounded-xl border ${
        highlightStyles.borderGradient
          ? "border-transparent"
          : highlightStyles.borderOverride
          ? "border-transparent"
          : "border-cyan-400/40"
      } ${
        highlightStyles.bgOverride
          ? highlightStyles.bgOverride
          : "bg-slate-900/90"
      } px-3 py-2.5 text-xs ${
        highlightStyles.borderOverride ? "" : "shadow-md shadow-cyan-500/10"
      } ${highlightStyles.className} ${data.dimmed ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-400/30 bg-slate-800 text-[10px] text-slate-400">
          {data.avatarUrl ? (
            <img
              src={data.avatarUrl}
              alt={data.label}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span>{data.label.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-200">
              {data.label}
            </span>
            {hasFlowStats && (
              <FlowStatsDisplay incoming={data.incomingFlows} outgoing={data.outgoingFlows} compact />
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );

  // If "both" highlight, wrap with gradient border container
  if (highlightStyles.borderGradient) {
    return (
      <div className="flex flex-col">
        <div className="rounded-xl bg-gradient-to-br from-emerald-400 via-yellow-400 to-red-400 p-[2px]">
          {regularCardInner}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {regularCardInner}
    </div>
  );
}

type UserListItem = {
  id: string;
  label: string;
  address: string;
  avatarUrl?: string;
  totalOutgoingFlowRate: bigint;
  isDistributor: boolean;
  incomingFlows?: FlowStats;
  outgoingFlows?: FlowStats;
};

type NavigationPanelProps = {
  users: UserListItem[];
  selectedNodeId: string | null;
  onUserClick: (nodeId: string) => void;
  nodeCount: number;
  edgeCount: number;
};

const NAV_PANEL_WIDTH = 200;

function NavigationPanel({
  users,
  selectedNodeId,
  onUserClick,
  nodeCount,
  edgeCount,
}: NavigationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const userRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Scroll to selected user when selection changes (from map click)
  useEffect(() => {
    if (!isExpanded || !selectedNodeId) return;
    const element = userRefs.current.get(selectedNodeId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedNodeId, isExpanded]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const query = searchQuery.toLowerCase();
    return users.filter(
      (user) =>
        user.label.toLowerCase().includes(query) ||
        user.address.toLowerCase().includes(query)
    );
  }, [users, searchQuery]);

  return (
    <div className="flex flex-col-reverse gap-1" style={{ width: NAV_PANEL_WIDTH }}>
      {/* MiniMap */}
      <MiniMap
        nodeColor={(node) => {
          const hasDistributedPools = node.data?.distributedPools?.length > 0;
          return hasDistributedPools ? "#0ea5e9" : "#38bdf8";
        }}
        maskColor="rgba(15,23,42,0.8)"
        style={{ position: "relative", width: NAV_PANEL_WIDTH, height: 120, margin: 0 }}
        className="!static !m-0 rounded border border-slate-700/80"
      />

      {/* User List Section - header at bottom, content grows upward */}
      {users.length > 0 && (
        <div className="flex max-h-[350px] flex-col-reverse rounded border border-slate-700/80 bg-slate-900/95 shadow-md">
          {/* Header - at bottom, always visible */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex shrink-0 items-center justify-between px-2 py-1.5 text-left transition-colors hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-1.5">
              <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-[10px] text-slate-300">
                {isExpanded ? `Users (${filteredUsers.length})` : `${users.length} Users`}
              </span>
            </div>
            <svg
              className={`h-3 w-3 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {/* Expanded content - renders above header */}
          {isExpanded && (
            <div className="flex min-h-0 flex-1 flex-col-reverse">
              {/* Search input - at bottom of expanded content */}
              <div className="shrink-0 border-b border-slate-700/50 px-2 py-1.5">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700/50 focus:ring-cyan-500/50"
                />
              </div>

              {/* User list - scrolls above search */}
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-b border-slate-700/50">
                  {filteredUsers.map((user) => {
                    const isSelected = selectedNodeId === user.id;

                    return (
                      <button
                        key={user.id}
                        ref={(el) => {
                          if (el) {
                            userRefs.current.set(user.id, el);
                          } else {
                            userRefs.current.delete(user.id);
                          }
                        }}
                        type="button"
                        onClick={() => onUserClick(user.id)}
                        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-slate-700/50 ${
                          isSelected ? "bg-cyan-500/25" : ""
                        }`}
                      >
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[7px] ${
                          user.isDistributor ? "bg-sky-500/60" : "bg-cyan-500/40"
                        }`}
                      >
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.label}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-slate-300 font-medium">
                            {user.label.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span
                        className={`min-w-0 flex-1 truncate text-[10px] ${
                          isSelected ? "text-cyan-200 font-medium" : "text-slate-300"
                        }`}
                      >
                        {user.label}
                      </span>
                      <CompactUserCounts incoming={user.incomingFlows} outgoing={user.outgoingFlows} />
                    </button>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <div className="px-2 py-3 text-center text-[9px] text-slate-500">
                    No users found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBigIntFlowRate(flowRate: bigint): string | null {
  if (flowRate <= 0n) return null;
  const daily = flowRate * 86400n;
  const divisor = BigInt(10) ** 18n;
  const whole = daily / divisor;
  const fraction = daily % divisor;
  const fractionStr = fraction.toString().padStart(18, "0").slice(0, 2);
  return `${whole}.${fractionStr}/day`;
}

type SettingsPanelProps = {
  config: BeamrConfig;
  onChange: (config: BeamrConfig) => void;
  onSave: () => void;
};

function SettingsPanel({ config, onChange, onSave }: SettingsPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-left text-xs text-slate-300">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Superfluid subgraph URL
        </label>
        <input
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
          placeholder="https://..."
          value={config.subgraphUrl}
          onChange={(event) =>
            onChange({ ...config, subgraphUrl: event.target.value })
          }
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          BEAMR token address
        </label>
        <input
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
          placeholder="0x..."
          value={config.tokenAddress}
          onChange={(event) =>
            onChange({ ...config, tokenAddress: event.target.value })
          }
        />
      </div>
      <button
        type="button"
        onClick={onSave}
        className="inline-flex items-center rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow hover:bg-cyan-400"
      >
        Save & reload
      </button>
    </div>
  );
}

