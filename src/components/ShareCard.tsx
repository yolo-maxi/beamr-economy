import { useRef, useCallback, useState, useEffect } from "react";
import html2canvas from "html2canvas";
import { shortenAddress } from "../lib/utils";
import type { Edge, Node } from "reactflow";

/* ─── Types ───────────────────────────────────────────────────────────────── */

type FlowStats = {
  totalFlowRate: bigint;
  userCount: number;
};

type UserData = {
  address: string;
  label: string;
  farcaster?: string;
  avatarUrl?: string;
  incomingFlows?: FlowStats;
  outgoingFlows?: FlowStats;
};

type StreamPeer = {
  id: string;
  label: string;
  avatarUrl?: string;
  flowRate: bigint;
  dailyFormatted: string;
};

type ShareCardProps = {
  selectedNodeId: string;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function formatDailyRate(flowRate: bigint): string {
  const daily = flowRate * 86400n;
  const divisor = 10n ** 18n;
  const whole = daily / divisor;
  const fraction = daily % divisor;
  const fractionNum = Number(fraction) / Number(divisor);
  const total = Number(whole) + fractionNum;

  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K`;
  if (total >= 1) return total.toFixed(1);
  if (total > 0) return total.toPrecision(2);
  return "0";
}

function formatDailyRateWithCommas(flowRate: bigint): string {
  const daily = flowRate * 86400n;
  const divisor = 10n ** 18n;
  const whole = daily / divisor;
  const fraction = daily % divisor;
  const fractionNum = Number(fraction) / Number(divisor);
  const total = Number(whole) + fractionNum;

  if (total >= 1_000_000)
    return `${(total / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (total >= 1_000)
    return total.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (total >= 1) return total.toFixed(1);
  if (total > 0) return total.toPrecision(2);
  return "0";
}

/* ─── SVG Arc Helpers ──────────────────────────────────────────────────── */

/** Convert degrees to radians */
function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Point on a circle at given angle (degrees, 0 = right, clockwise) */
function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = deg2rad(angleDeg - 90); // SVG: 0° = top
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Build an SVG path for a donut arc (annular sector).
 * Angles in degrees, 0 = top, clockwise.
 */
function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  // Clamp near-full arcs to avoid SVG arc rendering issues
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep) < 0.01) return "";
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;

  const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

/* Green shades for incoming slices */
const GREEN_SHADES = [
  "#10b981",
  "#34d399",
  "#059669",
  "#6ee7b7",
  "#047857",
  "#a7f3d0",
  "#065f46",
  "#d1fae5",
];

/* Red shades for outgoing slices */
const RED_SHADES = [
  "#ef4444",
  "#f87171",
  "#dc2626",
  "#fca5a5",
  "#b91c1c",
  "#fecaca",
  "#991b1b",
  "#fee2e2",
];

/** Compute slice layout for one half of the donut.
 *  Returns array of { startAngle, endAngle, midAngle } in degrees.
 *  `halfStart` / `halfEnd` define the 180° range.
 *  `totalFlow` is the sum for this side; `maxFlow` is the larger of in/out.
 *  A "net" slice fills any remaining angular space.
 */
function computeSlices(
  peers: StreamPeer[],
  totalFlow: bigint,
  displayedFlow: bigint, // flow of just the displayed peers (not overflow)
  maxFlow: bigint,
  halfStart: number,
  halfEnd: number,
  _gapDeg: number
): {
  slices: { startAngle: number; endAngle: number; midAngle: number }[];
  overflowSlice: { startAngle: number; endAngle: number } | null;
  netSlice: { startAngle: number; endAngle: number } | null;
} {
  const halfSpan = halfEnd - halfStart; // 180°
  const gapDeg = peers.length > 0 ? _gapDeg : 0;

  // How much of the 180° this side fills (proportional to max side)
  const fillRatio = maxFlow > 0n ? Number(totalFlow) / Number(maxFlow) : 0;
  const filledSpan = halfSpan * fillRatio;

  // Displayed peers' share of the filled span
  const displayedRatio = totalFlow > 0n ? Number(displayedFlow) / Number(totalFlow) : 1;
  const displayedSpan = filledSpan * displayedRatio;
  const overflowSpan = filledSpan - displayedSpan;

  // Gaps between displayed peer slices
  const numGaps = peers.length > 1 ? peers.length - 1 : 0;
  const totalGapInDisplayed = Math.min(numGaps * gapDeg, displayedSpan * 0.15);
  const availableForSlices = Math.max(displayedSpan - totalGapInDisplayed, 0);

  let cursor = halfStart;
  const slices = peers.map((peer) => {
    const ratio = displayedFlow > 0n ? Number(peer.flowRate) / Number(displayedFlow) : 0;
    const sliceSpan = availableForSlices * ratio;
    const start = cursor;
    const end = cursor + sliceSpan;
    cursor = end + gapDeg;
    return {
      startAngle: start,
      endAngle: end,
      midAngle: (start + end) / 2,
    };
  });

  const usedEnd = peers.length > 0 ? cursor - gapDeg : halfStart;

  // Overflow slice ("+N more" peers) — hatched pattern
  let overflowSlice: { startAngle: number; endAngle: number } | null = null;
  let overflowEnd = usedEnd;
  if (overflowSpan > 2) {
    const oStart = usedEnd + (peers.length > 0 ? gapDeg : 0);
    const oEnd = oStart + overflowSpan;
    overflowSlice = { startAngle: oStart, endAngle: oEnd };
    overflowEnd = oEnd;
  }

  // Net slice fills remaining space (balance difference)
  let netSlice: { startAngle: number; endAngle: number } | null = null;
  const netStart = overflowSlice ? overflowSlice.endAngle + gapDeg : usedEnd + (peers.length > 0 ? gapDeg : 0);
  if (halfEnd - netStart > 2) {
    netSlice = { startAngle: netStart, endAngle: halfEnd };
  }

  return { slices, overflowSlice, netSlice };
}

/* ─── Hero Diagram (SVG) ─────────────────────────────────────────────────── */

function HeroDiagram({
  incoming,
  outgoing,
  avatarUrl,
  label,
}: {
  incoming: StreamPeer[];
  outgoing: StreamPeer[];
  avatarUrl?: string;
  label: string;
}) {
  const W = 570;
  const H = 240;
  const cx = W / 2;
  const cy = H / 2;

  const maxPeers = 8;
  const inPeers = incoming.slice(0, maxPeers);
  const outPeers = outgoing.slice(0, maxPeers);
  const inExtra = incoming.length - inPeers.length;
  const outExtra = outgoing.length - outPeers.length;

  // Incoming: left semi-circle (PI/2 to 3PI/2, i.e. left side)
  const inPositions = inPeers.map((_, i) => {
    const startAngle = Math.PI * 0.6;
    const endAngle = Math.PI * 1.4;
    const count = inPeers.length + (inExtra > 0 ? 1 : 0);
    const angle =
      count === 1
        ? Math.PI
        : startAngle + ((endAngle - startAngle) / (count - 1)) * i;
    const rx = 220;
    const ry = 95;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });

  // Outgoing: right semi-circle (−PI/2 to PI/2, i.e. right side)
  const outPositions = outPeers.map((_, i) => {
    const startAngle = -Math.PI * 0.4;
    const endAngle = Math.PI * 0.4;
    const count = outPeers.length + (outExtra > 0 ? 1 : 0);
    const angle =
      count === 1
        ? 0
        : startAngle + ((endAngle - startAngle) / (count - 1)) * i;
    const rx = 220;
    const ry = 95;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });

  // "+N more" positions
  const inExtraPos = inExtra > 0
    ? (() => {
        const count = inPeers.length + 1;
        const startAngle = Math.PI * 0.6;
        const endAngle = Math.PI * 1.4;
        const angle =
          startAngle +
          ((endAngle - startAngle) / (count - 1)) * inPeers.length;
        return {
          x: cx + Math.cos(angle) * 200,
          y: cy + Math.sin(angle) * 75,
        };
      })()
    : null;

  const outExtraPos = outExtra > 0
    ? (() => {
        const count = outPeers.length + 1;
        const startAngle = -Math.PI * 0.4;
        const endAngle = Math.PI * 0.4;
        const angle =
          startAngle +
          ((endAngle - startAngle) / (count - 1)) * outPeers.length;
        return {
          x: cx + Math.cos(angle) * 200,
          y: cy + Math.sin(angle) * 75,
        };
      })()
    : null;

  const nodeRadius = 16;
  const peerRy = 95; // radial Y spread for peer positioning (must match ry in position calcs)

  /* ─── Donut ring parameters ─── */
  const outerR = 34;
  const innerR = 24;
  const avatarR = innerR - 2; // avatar fits inside the hole
  const gapDeg = 2; // gap between slices in degrees

  // Total flow rates (use ALL peers, not just displayed ones)
  const totalIn = incoming.reduce((s, p) => s + p.flowRate, 0n);
  const totalOut = outgoing.reduce((s, p) => s + p.flowRate, 0n);
  const maxFlow = totalIn > totalOut ? totalIn : totalOut;

  // Displayed peers' flow (for splitting overflow from net)
  const displayedInFlow = inPeers.reduce((s, p) => s + p.flowRate, 0n);
  const displayedOutFlow = outPeers.reduce((s, p) => s + p.flowRate, 0n);

  // Left half: incoming — goes from 180° to 360°
  const inLayout = computeSlices(inPeers, totalIn, displayedInFlow, maxFlow > 0n ? maxFlow : 1n, 180, 360, gapDeg);

  // Right half: outgoing — goes from 0° to 180°
  const outLayout = computeSlices(outPeers, totalOut, displayedOutFlow, maxFlow > 0n ? maxFlow : 1n, 0, 180, gapDeg);

  // Get the point on the outer ring at a given donut-angle (degrees)
  function ringPoint(angleDeg: number): { x: number; y: number } {
    return polarToCartesian(cx, cy, outerR, angleDeg);
  }

  // Arrow helper: draw arrowhead near target
  function arrowHead(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    offset: number,
    key: string
  ) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const ax = toX - Math.cos(angle) * offset;
    const ay = toY - Math.sin(angle) * offset;
    const size = 5;
    return (
      <polygon
        key={key}
        points={`${ax},${ay} ${ax - size * Math.cos(angle - 0.5)},${ay - size * Math.sin(angle - 0.5)} ${ax - size * Math.cos(angle + 0.5)},${ay - size * Math.sin(angle + 0.5)}`}
        fill={color}
        opacity="0.8"
      />
    );
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block" }}
    >
      <defs>
        {/* Hatched pattern for overflow ("+N more") slices */}
        <pattern id="hatch-green" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#0f172a" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#10b981" strokeWidth="1.5" opacity="0.6" />
        </pattern>
        <pattern id="hatch-red" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#0f172a" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#ef4444" strokeWidth="1.5" opacity="0.6" />
        </pattern>
        <filter id="glow-center">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-in">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-out">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Clip paths for peer avatars */}
        {inPeers.map((_, i) => (
          <clipPath key={`clip-in-${i}`} id={`clip-in-${i}`}>
            <circle
              cx={inPositions[i].x}
              cy={inPositions[i].y}
              r={nodeRadius - 2}
            />
          </clipPath>
        ))}
        {outPeers.map((_, i) => (
          <clipPath key={`clip-out-${i}`} id={`clip-out-${i}`}>
            <circle
              cx={outPositions[i].x}
              cy={outPositions[i].y}
              r={nodeRadius - 2}
            />
          </clipPath>
        ))}
        <clipPath id="clip-center">
          <circle cx={cx} cy={cy} r={avatarR} />
        </clipPath>
      </defs>

      {/* ── Incoming lines + arrows (to slice midpoints) ── */}
      {inPositions.map((pos, i) => {
        const sliceMid = inLayout.slices[i]
          ? ringPoint(inLayout.slices[i].midAngle)
          : { x: cx, y: cy };
        return (
          <g key={`in-line-${i}`}>
            <line
              x1={pos.x}
              y1={pos.y}
              x2={sliceMid.x}
              y2={sliceMid.y}
              stroke={GREEN_SHADES[i % GREEN_SHADES.length]}
              strokeWidth="1.5"
              strokeDasharray="6 4"
              opacity="0.5"
            />
            {arrowHead(
              pos.x,
              pos.y,
              sliceMid.x,
              sliceMid.y,
              GREEN_SHADES[i % GREEN_SHADES.length],
              4,
              `in-arrow-${i}`
            )}
          </g>
        );
      })}

      {/* ── Outgoing lines + arrows (from slice midpoints) ── */}
      {outPositions.map((pos, i) => {
        const sliceMid = outLayout.slices[i]
          ? ringPoint(outLayout.slices[i].midAngle)
          : { x: cx, y: cy };
        return (
          <g key={`out-line-${i}`}>
            <line
              x1={sliceMid.x}
              y1={sliceMid.y}
              x2={pos.x}
              y2={pos.y}
              stroke={RED_SHADES[i % RED_SHADES.length]}
              strokeWidth="1.5"
              strokeDasharray="6 4"
              opacity="0.5"
            />
            {arrowHead(
              sliceMid.x,
              sliceMid.y,
              pos.x,
              pos.y,
              RED_SHADES[i % RED_SHADES.length],
              nodeRadius + 4,
              `out-arrow-${i}`
            )}
          </g>
        );
      })}

      {/* ── Extra count lines ── */}
      {inExtraPos && (
        <line
          x1={inExtraPos.x}
          y1={inExtraPos.y}
          x2={cx}
          y2={cy}
          stroke="#10b981"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.25"
        />
      )}
      {outExtraPos && (
        <line
          x1={cx}
          y1={cy}
          x2={outExtraPos.x}
          y2={outExtraPos.y}
          stroke="#ef4444"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.25"
        />
      )}

      {/* ── Incoming peer nodes ── */}
      {inPeers.map((peer, i) => (
        <g key={`in-node-${i}`}>
          <circle
            cx={inPositions[i].x}
            cy={inPositions[i].y}
            r={nodeRadius}
            fill="#0f172a"
            stroke="#10b981"
            strokeWidth="1.5"
            filter="url(#glow-in)"
          />
          {peer.avatarUrl ? (
            <image
              href={peer.avatarUrl}
              x={inPositions[i].x - (nodeRadius - 2)}
              y={inPositions[i].y - (nodeRadius - 2)}
              width={(nodeRadius - 2) * 2}
              height={(nodeRadius - 2) * 2}
              clipPath={`url(#clip-in-${i})`}
            />
          ) : (
            <text
              x={inPositions[i].x}
              y={inPositions[i].y + 3}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="8"
              fontFamily="system-ui, sans-serif"
            >
              {peer.label.slice(0, 3)}
            </text>
          )}
          {/* Name label — side labels for middle nodes, below for top/bottom */}
          {(() => {
            const isMiddle = Math.abs(inPositions[i].y - cy) < peerRy * 0.65;
            // Never truncate names, only truncate addresses (0x...)
            const displayLabel = peer.label.startsWith("0x")
              ? peer.label.slice(0, 6) + "..." + peer.label.slice(-4)
              : peer.label;
            if (isMiddle) {
              return (
                <text
                  x={inPositions[i].x - nodeRadius - 4}
                  y={inPositions[i].y + 3}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="7"
                  fontFamily="system-ui, sans-serif"
                >
                  {displayLabel}
                </text>
              );
            }
            return (
              <text
                x={inPositions[i].x}
                y={inPositions[i].y + nodeRadius + 10}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="7"
                fontFamily="system-ui, sans-serif"
              >
                {displayLabel}
              </text>
            );
          })()}
        </g>
      ))}

      {/* ── Incoming "+N more" ── */}
      {inExtraPos && (
        <g>
          <circle
            cx={inExtraPos.x}
            cy={inExtraPos.y}
            r={13}
            fill="#0f172a"
            stroke="#10b981"
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.6"
          />
          <text
            x={inExtraPos.x}
            y={inExtraPos.y + 3.5}
            textAnchor="middle"
            fill="#10b981"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui, sans-serif"
          >
            +{inExtra} more
          </text>
        </g>
      )}

      {/* ── Outgoing peer nodes ── */}
      {outPeers.map((peer, i) => (
        <g key={`out-node-${i}`}>
          <circle
            cx={outPositions[i].x}
            cy={outPositions[i].y}
            r={nodeRadius}
            fill="#0f172a"
            stroke="#ef4444"
            strokeWidth="1.5"
            filter="url(#glow-out)"
          />
          {peer.avatarUrl ? (
            <image
              href={peer.avatarUrl}
              x={outPositions[i].x - (nodeRadius - 2)}
              y={outPositions[i].y - (nodeRadius - 2)}
              width={(nodeRadius - 2) * 2}
              height={(nodeRadius - 2) * 2}
              clipPath={`url(#clip-out-${i})`}
            />
          ) : (
            <text
              x={outPositions[i].x}
              y={outPositions[i].y + 3}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="8"
              fontFamily="system-ui, sans-serif"
            >
              {peer.label.slice(0, 3)}
            </text>
          )}
          {/* Name label — side labels for middle nodes, below for top/bottom */}
          {(() => {
            const isMiddle = Math.abs(outPositions[i].y - cy) < peerRy * 0.65;
            const displayLabel = peer.label.startsWith("0x")
              ? peer.label.slice(0, 6) + "..." + peer.label.slice(-4)
              : peer.label;
            if (isMiddle) {
              return (
                <text
                  x={outPositions[i].x + nodeRadius + 4}
                  y={outPositions[i].y + 3}
                  textAnchor="start"
                  fill="#94a3b8"
                  fontSize="7"
                  fontFamily="system-ui, sans-serif"
                >
                  {displayLabel}
                </text>
              );
            }
            return (
              <text
                x={outPositions[i].x}
                y={outPositions[i].y + nodeRadius + 10}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="7"
                fontFamily="system-ui, sans-serif"
              >
                {displayLabel}
              </text>
            );
          })()}
        </g>
      ))}

      {/* ── Outgoing "+N more" ── */}
      {outExtraPos && (
        <g>
          <circle
            cx={outExtraPos.x}
            cy={outExtraPos.y}
            r={13}
            fill="#0f172a"
            stroke="#ef4444"
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.6"
          />
          <text
            x={outExtraPos.x}
            y={outExtraPos.y + 3.5}
            textAnchor="middle"
            fill="#ef4444"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui, sans-serif"
          >
            +{outExtra} more
          </text>
        </g>
      )}

      {/* ── Center donut ring (Sankey-style pie chart) ── */}
      <g filter="url(#glow-center)">
        {/* Background ring (dark base) */}
        <circle
          cx={cx}
          cy={cy}
          r={(outerR + innerR) / 2}
          fill="none"
          stroke="#0f172a"
          strokeWidth={outerR - innerR}
        />

        {/* Incoming (left half) green slices */}
        {inLayout.slices.map((slice, i) => {
          const d = describeArc(cx, cy, outerR, innerR, slice.startAngle, slice.endAngle);
          return d ? (
            <path
              key={`in-slice-${i}`}
              d={d}
              fill={GREEN_SHADES[i % GREEN_SHADES.length]}
              opacity="0.85"
            />
          ) : null;
        })}

        {/* Incoming overflow slice ("+N more" — hatched green) */}
        {inLayout.overflowSlice && (
          <path
            d={describeArc(cx, cy, outerR, innerR, inLayout.overflowSlice.startAngle, inLayout.overflowSlice.endAngle)}
            fill="url(#hatch-green)"
          />
        )}

        {/* Incoming net slice (gray filler) */}
        {inLayout.netSlice && (
          <path
            d={describeArc(cx, cy, outerR, innerR, inLayout.netSlice.startAngle, inLayout.netSlice.endAngle)}
            fill="#475569"
            opacity="0.4"
          />
        )}

        {/* Outgoing (right half) red slices */}
        {outLayout.slices.map((slice, i) => {
          const d = describeArc(cx, cy, outerR, innerR, slice.startAngle, slice.endAngle);
          return d ? (
            <path
              key={`out-slice-${i}`}
              d={d}
              fill={RED_SHADES[i % RED_SHADES.length]}
              opacity="0.85"
            />
          ) : null;
        })}

        {/* Outgoing overflow slice ("+N more" — hatched red) */}
        {outLayout.overflowSlice && (
          <path
            d={describeArc(cx, cy, outerR, innerR, outLayout.overflowSlice.startAngle, outLayout.overflowSlice.endAngle)}
            fill="url(#hatch-red)"
          />
        )}

        {/* Outgoing net slice (gray filler) */}
        {outLayout.netSlice && (
          <path
            d={describeArc(cx, cy, outerR, innerR, outLayout.netSlice.startAngle, outLayout.netSlice.endAngle)}
            fill="#475569"
            opacity="0.4"
          />
        )}

        {/* Outer glow ring */}
        <circle
          cx={cx}
          cy={cy}
          r={outerR + 2}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="1"
          opacity="0.25"
        />
      </g>

      {/* ── Center avatar (inside donut hole) ── */}
      <circle cx={cx} cy={cy} r={innerR} fill="#0f172a" />
      {avatarUrl ? (
        <image
          href={avatarUrl}
          x={cx - avatarR}
          y={cy - avatarR}
          width={avatarR * 2}
          height={avatarR * 2}
          clipPath="url(#clip-center)"
        />
      ) : (
        <text
          x={cx}
          y={cy + 5}
          textAnchor="middle"
          fill="#e2e8f0"
          fontSize="12"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          {label.slice(0, 3)}
        </text>
      )}
    </svg>
  );
}

/* ─── Share Card Modal ────────────────────────────────────────────────────── */

export default function ShareCard({
  selectedNodeId,
  nodes,
  edges,
  onClose,
}: ShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Gather data
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const userData = selectedNode?.data as UserData | undefined;

  const incomingStreams: StreamPeer[] = edges
    .filter((e) => e.target === selectedNodeId)
    .map((edge) => {
      const src = nodes.find((n) => n.id === edge.source);
      const srcData = src?.data as UserData | undefined;
      const fr = BigInt(edge.data?.flowRate ?? "0");
      return {
        id: edge.source,
        label:
          srcData?.label ??
          shortenAddress(edge.source.replace("account:", "")),
        avatarUrl: srcData?.avatarUrl,
        flowRate: fr,
        dailyFormatted: formatDailyRate(fr),
      };
    })
    .sort((a, b) => (b.flowRate > a.flowRate ? 1 : -1));

  const outgoingStreams: StreamPeer[] = edges
    .filter((e) => e.source === selectedNodeId)
    .map((edge) => {
      const tgt = nodes.find((n) => n.id === edge.target);
      const tgtData = tgt?.data as UserData | undefined;
      const fr = BigInt(edge.data?.flowRate ?? "0");
      return {
        id: edge.target,
        label:
          tgtData?.label ??
          shortenAddress(edge.target.replace("account:", "")),
        avatarUrl: tgtData?.avatarUrl,
        flowRate: fr,
        dailyFormatted: formatDailyRate(fr),
      };
    })
    .sort((a, b) => (b.flowRate > a.flowRate ? 1 : -1));

  const totalIn = incomingStreams.reduce((s, p) => s + p.flowRate, 0n);
  const totalOut = outgoingStreams.reduce((s, p) => s + p.flowRate, 0n);

  if (!userData) return null;

  /* ─── Capture → PNG (2x for 1200×630) then share ───────────────────────── */

  const captureCard = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (!cardRef.current) return null;
    setCapturing(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2, // 600×315 at 2x → 1200×630
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: 600,
        height: 315,
      });
      return canvas;
    } catch (err) {
      console.error("html2canvas failed:", err);
      return null;
    } finally {
      setCapturing(false);
    }
  }, []);

  const handleShareFarcaster = useCallback(async () => {
    // Step 1: Download the image
    const canvas = await captureCard();
    if (canvas) {
      const link = document.createElement("a");
      link.download = `beamr-flow-${userData.label.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }

    // Step 2: Open Warpcast compose (short delay so download starts first)
    setTimeout(() => {
      const warpcastUrl =
        "https://warpcast.com/~/compose?text=Check+out+my+%24BEAMR+streaming+position!+%F0%9F%8C%8A&embeds[]=https://beamr.repo.box";
      window.open(warpcastUrl, "_blank", "noopener,noreferrer");
    }, 300);
  }, [captureCard, userData.label]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/80 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      <div className="flex flex-col items-center" style={{ gap: '220px' }}>
        {/* ─── The Card (600×315 = 1.91:1 for Farcaster OG) ─────────── */}
        <div
          ref={cardRef}
          style={{ width: 600, height: 315, transform: 'scale(1.6)', transformOrigin: 'top center' }}
          className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-[#0c1222] via-[#0f172a] to-[#131c33] shadow-2xl shadow-cyan-500/10"
        >
          {/* Subtle grid pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(6,182,212,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.4) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          {/* Content wrapper */}
          <div className="relative flex h-full flex-col px-5 py-2">
            {/* Header: Receiving | Handle | Sending — single centered line */}
            <div className="mb-1 flex items-center justify-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-emerald-400">↓</span>
                <span className="text-xs font-bold text-emerald-400">
                  {formatDailyRateWithCommas(totalIn)}
                </span>
                <span className="text-[9px] text-slate-500">/day</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-100">
                  {userData.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-red-400">↑</span>
                <span className="text-xs font-bold text-red-400">
                  {formatDailyRateWithCommas(totalOut)}
                </span>
                <span className="text-[9px] text-slate-500">/day</span>
              </div>
            </div>

            {/* ── HERO: Node diagram (~60-70% of card) ── */}
            <div className="flex flex-1 items-center justify-center">
              <HeroDiagram
                incoming={incomingStreams}
                outgoing={outgoingStreams}
                avatarUrl={userData.avatarUrl}
                label={userData.label}
              />
            </div>

            {/* Footer */}
            <div className="mt-auto flex items-center justify-between border-t border-slate-700/50 pt-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-wide text-cyan-400">
                  BEAMR
                </span>
                <span className="text-[10px] text-slate-500">
                  beamr.repo.box
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                Powered by Superfluid
              </div>
            </div>
          </div>
        </div>

        {/* ─── Single Action Button: Share on Farcaster ──────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleShareFarcaster}
            disabled={capturing}
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 disabled:opacity-50"
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
            {capturing ? "Capturing…" : "Share on Farcaster"}
          </button>
        </div>
      </div>
    </div>
  );
}
