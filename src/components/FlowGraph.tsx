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
} from "../lib/superfluid";
import { preloadImage } from "../lib/imageCache";
import { shortenAddress, formatCompactFlowRate, formatTokenBalance, saveNodePositions, formatLastActivity } from "../lib/utils";
import {
  loadCachedBeamrData,
  saveBeamrData,
  mergeBeamrData,
  hasBeamrDataChanges,
} from "../lib/dataCache";
import UserProfilePanel from "./UserProfilePanel";
import FindYourselfModal, { shouldShowFindYourselfModal } from "./FindYourselfModal";

const POLL_INTERVAL_MS = 60_000;
const NODE_TYPES = {
  user: UserNode,
};

// Read user param from URL on initial load
function getInitialSelectedUser(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("user");
}

// Update URL with selected user
function updateUrlWithUser(userId: string | null) {
  const url = new URL(window.location.href);
  if (userId) {
    url.searchParams.set("user", userId);
  } else {
    url.searchParams.delete("user");
  }
  window.history.replaceState({}, "", url.toString());
}

type FlowGraphProps = {
  onStreamCountChange?: (count: number) => void;
};

export default function FlowGraph({ onStreamCountChange }: FlowGraphProps) {
  const [config] = useState<BeamrConfig>(() => readBeamrConfig());
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    getInitialSelectedUser
  );
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [currentData, setCurrentData] = useState<BeamrData | null>(null);
  const [nodesDraggable, setNodesDraggable] = useState(true);
  const [filterMode, setFilterMode] = useState<"none" | "only-receive" | "only-send">("none");
  const [searchAddress, setSearchAddress] = useState("");
  const [showFindModal, setShowFindModal] = useState(() => shouldShowFindYourselfModal());

  // Report edge count (active streams) to parent
  useEffect(() => {
    onStreamCountChange?.(edges.length);
  }, [edges.length, onStreamCountChange]);

  // Sync selectedNodeId to URL
  useEffect(() => {
    updateUrlWithUser(selectedNodeId);
  }, [selectedNodeId]);

  // When loading from URL with a user param, resolve and fit view
  const initialUserFromUrl = useRef(getInitialSelectedUser());
  useEffect(() => {
    const param = initialUserFromUrl.current;
    if (!param || !reactFlowInstance || nodes.length === 0) return;

    // Try exact match first (e.g. account:0x...)
    let matchedId: string | null = null;
    if (nodes.some((n) => n.id === param)) {
      matchedId = param;
    } else {
      // Try matching by address (with or without account: prefix)
      const searchLower = param.toLowerCase().replace(/^account:/, "");
      for (const n of nodes) {
        if (n.type !== "user") continue;
        const data = n.data as { address?: string; label?: string; farcaster?: string };
        // Match by address
        if (data.address?.toLowerCase() === searchLower) {
          matchedId = n.id;
          break;
        }
        // Match by Farcaster handle (with or without @)
        const handle = searchLower.replace(/^@/, "");
        if (data.farcaster?.toLowerCase() === handle || data.label?.toLowerCase() === handle || data.label?.toLowerCase() === `@${handle}`) {
          matchedId = n.id;
          break;
        }
      }
    }

    if (matchedId) {
      setSelectedNodeId(matchedId);
      reactFlowInstance.fitView({ duration: 600 });
      initialUserFromUrl.current = null;
    }
  }, [reactFlowInstance, nodes]);

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

    // Fetch immediately on config change or retry (but don't show loading)
    fetchAndMerge();
    const interval = setInterval(fetchAndMerge, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [config, retryCount]);

  const handleRetry = () => {
    setError(null);
    setRetryCount((c) => c + 1);
  };

  const showEmptyState = !isInitialLoad && !error && nodes.length === 0;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to deselect
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        return;
      }

      // Arrow key navigation through users
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        
        // Get sorted user list (same as NavigationPanel)
        const userIds = nodes
          .filter((n) => n.type === "user")
          .filter((n) => {
            const data = n.data as { incomingFlows?: { userCount: number }; outgoingFlows?: { userCount: number } };
            const hasIncoming = data.incomingFlows && data.incomingFlows.userCount > 0;
            const hasOutgoing = data.outgoingFlows && data.outgoingFlows.userCount > 0;
            return hasIncoming || hasOutgoing;
          })
          .map((n) => n.id);

        if (userIds.length === 0) return;

        const currentIndex = selectedNodeId ? userIds.indexOf(selectedNodeId) : -1;
        let newIndex: number;

        if (e.key === "ArrowDown") {
          newIndex = currentIndex < userIds.length - 1 ? currentIndex + 1 : 0;
        } else {
          newIndex = currentIndex > 0 ? currentIndex - 1 : userIds.length - 1;
        }

        setSelectedNodeId(userIds[newIndex]);
        
        // Fit view when navigating
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ duration: 300 });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, selectedNodeId, reactFlowInstance]);

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

  // Top 5 streamers by total flow rate (incoming + outgoing)
  const topStreamers = useMemo(() => {
    return sortedUsers
      .map((user) => {
        const inRate = user.incomingFlows?.totalFlowRate ?? 0n;
        const outRate = user.outgoingFlows?.totalFlowRate ?? 0n;
        const totalRate = inRate + outRate;
        return { ...user, _totalRate: totalRate };
      })
      .sort((a, b) => {
        if (b._totalRate > a._totalRate) return 1;
        if (b._totalRate < a._totalRate) return -1;
        return 0;
      })
      .slice(0, 5);
  }, [sortedUsers]);

  const handleUserListClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    // Fit view to show full graph (same as box button in Controls)
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ duration: 600 });
    }
  };

  // Compute counts for filter buttons (always, regardless of active filter)
  const filterCounts = useMemo(() => {
    let onlyReceive = 0;
    let onlySend = 0;
    for (const node of nodes) {
      if (node.type !== "user") continue;
      const data = node.data as UserNodeProps["data"];
      const hasIncoming = data.incomingFlows && data.incomingFlows.userCount > 0;
      const hasOutgoing = data.outgoingFlows && data.outgoingFlows.userCount > 0;
      if (hasIncoming && !hasOutgoing) onlyReceive++;
      if (!hasIncoming && hasOutgoing) onlySend++;
    }
    return { onlyReceive, onlySend };
  }, [nodes]);

  // Compute which node IDs match the search address
  const searchMatchNodeId = useMemo(() => {
    if (!searchAddress.trim() || searchAddress.trim().length < 3) return null;
    const query = searchAddress.toLowerCase().trim();
    for (const node of nodes) {
      if (node.type !== "user") continue;
      const data = node.data as UserNodeProps["data"];
      if (
        data.address.toLowerCase().includes(query) ||
        data.label.toLowerCase().includes(query)
      ) {
        return node.id;
      }
    }
    return null;
  }, [nodes, searchAddress]);

  // Auto-select and zoom to searched node
  useEffect(() => {
    if (searchMatchNodeId && searchAddress.trim().length >= 3) {
      setSelectedNodeId(searchMatchNodeId);
      if (reactFlowInstance) {
        reactFlowInstance.fitView({ duration: 600 });
      }
    }
  }, [searchMatchNodeId, reactFlowInstance, searchAddress]);

  // Compute which node IDs match the current filter mode
  const filteredNodeIds = useMemo(() => {
    if (filterMode === "none") return null;
    const ids = new Set<string>();
    for (const node of nodes) {
      if (node.type !== "user") continue;
      const data = node.data as UserNodeProps["data"];
      const hasIncoming = data.incomingFlows && data.incomingFlows.userCount > 0;
      const hasOutgoing = data.outgoingFlows && data.outgoingFlows.userCount > 0;
      if (filterMode === "only-receive" && hasIncoming && !hasOutgoing) {
        ids.add(node.id);
      }
      if (filterMode === "only-send" && !hasIncoming && hasOutgoing) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [nodes, filterMode]);

  const { styledNodes, styledEdges } = useMemo(() => {
    const baseEdges = edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        opacity: 0.18,
      },
    }));

    const activeNodeId = selectedNodeId;

    // If filter mode is active and no node selected, apply filter highlighting
    if (!activeNodeId && filteredNodeIds && filteredNodeIds.size > 0) {
      // Collect edges connected to filtered nodes
      const filteredEdgeIds = new Set<string>();
      for (const edge of edges) {
        if (filteredNodeIds.has(edge.source) || filteredNodeIds.has(edge.target)) {
          filteredEdgeIds.add(edge.id);
        }
      }

      return {
        styledNodes: nodes.map((node) => {
          const isFiltered = filteredNodeIds.has(node.id);
          return {
            ...node,
            draggable: nodesDraggable,
            data: {
              ...node.data,
              highlight: isFiltered
                ? (filterMode === "only-receive" ? "upstream" : "downstream")
                : undefined,
              dimmed: !isFiltered,
            },
          };
        }),
        styledEdges: baseEdges.map((edge) => {
          if (!filteredEdgeIds.has(edge.id)) return edge;
          const stroke = filterMode === "only-receive" ? "#22c55e" : "#ef4444";
          return {
            ...edge,
            style: {
              ...edge.style,
              opacity: 0.7,
              stroke,
              strokeWidth: Math.max((edge.style?.strokeWidth as number) ?? 1.5, 4),
            },
          };
        }),
      };
    }

    if (!activeNodeId) {
      return {
        styledNodes: nodes.map((node) => ({
          ...node,
          draggable: nodesDraggable,
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
          draggable: nodesDraggable, // Respect global lock state
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
      // Only allow dragging if globally unlocked AND node is highlighted AND not dimmed
      const draggable = nodesDraggable && highlight !== undefined && !dimmed;
      return { ...node, draggable, data: { ...node.data, highlight, dimmed } };
    });

    return { styledNodes, styledEdges };
  }, [edges, selectedNodeId, nodes, nodesDraggable, filteredNodeIds, filterMode]);

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
      <div className="flex h-full items-center justify-center px-4 sm:px-8 text-center text-slate-300">
        <div className="max-w-2xl space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
          <div className="flex items-center justify-center gap-3 text-red-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-lg font-semibold text-slate-100">
              Unable to load Superfluid data
            </h2>
          </div>
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow hover:bg-cyan-400 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Retry
          </button>
          <p className="text-xs text-slate-400">
            Could not reach the Superfluid subgraph. Check your connection and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {showEmptyState && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-8 text-center text-slate-300">
          <div className="max-w-2xl space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-slate-100">
              No pools or streams returned
            </h2>
            <p className="text-sm text-slate-300">
              No active pools or streams found. Try refreshing the page.
            </p>
          </div>
        </div>
      )}
      {isInitialLoad && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/90">
          <div className="flex flex-col items-center gap-6">
            {/* Skeleton cards */}
            <div className="flex items-center gap-8">
              <div className="skeleton h-24 w-64 rounded-2xl" />
              <div className="skeleton h-24 w-64 rounded-2xl" />
            </div>
            <div className="flex items-center gap-12">
              <div className="skeleton h-16 w-44 rounded-xl" />
              <div className="skeleton h-16 w-44 rounded-xl" />
              <div className="skeleton h-16 w-44 rounded-xl" />
            </div>
            <div className="flex items-center gap-8">
              <div className="skeleton h-16 w-44 rounded-xl" />
              <div className="skeleton h-16 w-44 rounded-xl" />
            </div>
            {/* Loading text */}
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading BEAMR streams and pools...
            </div>
          </div>
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
        nodesFocusable={false}
        nodesConnectable={false}
        selectNodesOnDrag={false}
        panOnDrag={true}
        panOnScroll={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={true}
        preventScrolling={true}
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
                width="14"
                height="14"
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
                width="14"
                height="14"
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
        {/* Search bar removed — using the one in the user list instead */}
        {/* Navigation Panel - contains user list and minimap */}
        <Panel position="bottom-right" className="!m-3 !p-0" style={{ pointerEvents: 'auto' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <NavigationPanel
              users={sortedUsers}
              selectedNodeId={selectedNodeId}
              onUserClick={handleUserListClick}
              nodeCount={nodes.length}
              edgeCount={edges.length}
              filterMode={filterMode}
              onFilterChange={setFilterMode}
              onlyReceiveCount={filterCounts.onlyReceive}
              onlySendCount={filterCounts.onlySend}
              topStreamers={topStreamers}
            />
          </div>
        </Panel>
      </ReactFlow>
      {/* User Profile Panel - shows when a node is selected */}
      <UserProfilePanel
        selectedNodeId={selectedNodeId}
        nodes={nodes}
        edges={edges}
        onClose={() => setSelectedNodeId(null)}
      />
      {/* Find Yourself Modal - shown on first visit when no ?user= param */}
      {showFindModal && nodes.length > 0 && (
        <FindYourselfModal
          nodes={nodes}
          onSelectNode={(nodeId) => {
            setShowFindModal(false);
            setSelectedNodeId(nodeId);
            if (reactFlowInstance) {
              reactFlowInstance.fitView({ duration: 600 });
            }
          }}
          onSkip={() => setShowFindModal(false)}
        />
      )}
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
    balance?: string;
    updatedAtTimestamp?: string;
  };
};

/** Net flow direction arrow: green ↑ for positive (inflows > outflows), red ↓ for negative */
function NetFlowArrow({ incoming, outgoing }: {
  incoming?: FlowStats;
  outgoing?: FlowStats;
}) {
  const inRate = incoming?.totalFlowRate ?? 0n;
  const outRate = outgoing?.totalFlowRate ?? 0n;
  
  if (inRate === 0n && outRate === 0n) return null;
  
  const netFlow = inRate - outRate;
  
  if (netFlow > 0n) {
    // Positive: more incoming than outgoing (gaining)
    return (
      <span className="text-emerald-400 text-sm font-bold" title="Net positive flow (gaining BEAMR)">↑</span>
    );
  } else if (netFlow < 0n) {
    // Negative: more outgoing than incoming (losing)
    return (
      <span className="text-red-400 text-sm font-bold" title="Net negative flow (losing BEAMR)">↓</span>
    );
  }
  
  // Zero net flow
  return null;
}

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
            {data.updatedAtTimestamp && formatLastActivity(data.updatedAtTimestamp) && (
              <div className="text-[10px] text-slate-400">
                {formatLastActivity(data.updatedAtTimestamp)}
              </div>
            )}
          </div>
        </div>
        {/* BEAMR Balance */}
        {data.balance && formatTokenBalance(data.balance) && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-300">
            <span className="font-semibold">Balance: </span>
            <span className="font-bold text-sky-300">{formatTokenBalance(data.balance)} BEAMR</span>
            <NetFlowArrow incoming={data.incomingFlows} outgoing={data.outgoingFlows} />
          </div>
        )}
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
          {data.balance && formatTokenBalance(data.balance) && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
              <span>{formatTokenBalance(data.balance)} BEAMR</span>
              <NetFlowArrow incoming={data.incomingFlows} outgoing={data.outgoingFlows} />
            </div>
          )}
          {data.updatedAtTimestamp && formatLastActivity(data.updatedAtTimestamp) && (
            <div className="mt-0.5 text-[9px] text-slate-500">
              {formatLastActivity(data.updatedAtTimestamp)}
            </div>
          )}
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
  filterMode: "none" | "only-receive" | "only-send";
  onFilterChange: (mode: "none" | "only-receive" | "only-send") => void;
  onlyReceiveCount: number;
  onlySendCount: number;
  topStreamers: UserListItem[];
};

const NAV_PANEL_WIDTH = 240;

function NavigationPanel({
  users,
  selectedNodeId,
  onUserClick,
  nodeCount,
  edgeCount,
  filterMode,
  onFilterChange,
  onlyReceiveCount,
  onlySendCount,
  topStreamers,
}: NavigationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTopStreamersExpanded, setIsTopStreamersExpanded] = useState(false);
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
    <div className="flex flex-col-reverse gap-1 w-[180px] sm:w-[240px]" style={{ pointerEvents: 'auto' }}>
      {/* MiniMap */}
      <MiniMap
        nodeColor={(node) => {
          const hasDistributedPools = node.data?.distributedPools?.length > 0;
          return hasDistributedPools ? "#0ea5e9" : "#38bdf8";
        }}
        maskColor="rgba(15,23,42,0.8)"
        style={{ position: "relative", width: "100%", height: 100, margin: 0 }}
        className="!static !m-0 rounded border border-slate-700/80"
      />

      {/* Filter Buttons */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFilterChange(filterMode === "only-receive" ? "none" : "only-receive");
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`flex-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${
            filterMode === "only-receive"
              ? "bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-400/50"
              : "bg-slate-800/80 text-slate-400 ring-1 ring-slate-700/50 hover:bg-slate-700/50 hover:text-slate-300"
          }`}
          title="Highlight users who only receive flows (no outgoing)"
        >
          ↓ Only Receive ({onlyReceiveCount})
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFilterChange(filterMode === "only-send" ? "none" : "only-send");
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`flex-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${
            filterMode === "only-send"
              ? "bg-red-500/30 text-red-300 ring-1 ring-red-400/50"
              : "bg-slate-800/80 text-slate-400 ring-1 ring-slate-700/50 hover:bg-slate-700/50 hover:text-slate-300"
          }`}
          title="Highlight users who only send flows (no incoming)"
        >
          ↑ Only Send ({onlySendCount})
        </button>
      </div>

      {/* Top Streamers */}
      {topStreamers.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-slate-900/95 shadow-lg ring-1 ring-amber-400/20">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsTopStreamersExpanded(!isTopStreamersExpanded);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-full items-center justify-between px-2 py-1.5 text-left transition-colors hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]">🏆</span>
              <span className="text-[10px] text-amber-300 font-medium">Top Streamers</span>
            </div>
            <svg
              className={`h-3 w-3 text-slate-400 transition-transform ${isTopStreamersExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isTopStreamersExpanded && (
            <div className="border-t border-amber-500/20 px-1 py-1">
              {topStreamers.map((user, index) => {
                const isSelected = selectedNodeId === user.id;
                const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => onUserClick(user.id)}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-slate-700/50 ${
                      isSelected ? "bg-amber-500/20" : ""
                    }`}
                  >
                    <span className="w-4 text-center text-[9px]">{medal}</span>
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-[6px]">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.label} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="text-slate-300">{user.label.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <span className={`min-w-0 flex-1 truncate text-[10px] ${isSelected ? "text-amber-200 font-medium" : "text-slate-300"}`}>
                      {user.label}
                    </span>
                    <CompactUserCounts incoming={user.incomingFlows} outgoing={user.outgoingFlows} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* User List Section - header at bottom, content grows upward */}
      {users.length > 0 && (
        <div className="flex max-h-[350px] flex-col-reverse rounded border border-cyan-500/30 bg-slate-900/95 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/20 animate-panel-glow">
          {/* Header - at bottom, always visible */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center justify-between px-2 py-1.5 text-left transition-colors hover:bg-slate-800/50"
            style={{ pointerEvents: 'auto' }}
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

// Settings panel removed — config is hardcoded

