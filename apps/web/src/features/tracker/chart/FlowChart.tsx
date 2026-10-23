'use client';

import { ResponsiveSankey, type CustomSankeyLayerProps, type SankeyLinkDatum, type SankeyNodeDatum } from '@nivo/sankey';
import { createContext, useCallback, useContext, useMemo, useRef, type PointerEvent } from 'react';
import type { SankeyResponse } from '@tailorit/shared';
import { useStoredValue, writeStored } from '@/lib/storage';

/*
 * "Application flow": Nivo lays the Sankey out; the links, nodes and labels are drawn by our own layers so a stage can
 * be dragged anywhere ("Drag stages to rearrange your chart"). Offsets are remembered per browser until "Reset chart
 * positions".
 */

interface FlowNode {
  id: string;
  /** The status colour (Nivo's own `color` is computed from it). */
  fill: string;
  /** d3-sankey sizes a node by this when set: every application that reached the stage, linked onwards or not. */
  fixedValue: number;
}

interface FlowLink {
  source: string;
  target: string;
  value: number;
}

type Node = SankeyNodeDatum<FlowNode, FlowLink>;
type Link = SankeyLinkDatum<FlowNode, FlowLink>;
type LayerProps = CustomSankeyLayerProps<FlowNode, FlowLink>;
type Offsets = Record<string, { x: number; y: number }>;

export const CHART_POSITIONS_KEY = 'tailorit.tracker.chartPositions';

function readOffsets(raw: string): Offsets {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Offsets = {};
    for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
      const { x, y } = (point ?? {}) as { x?: unknown; y?: unknown };
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) out[id] = { x, y };
    }
    return out;
  } catch {
    return {};
  }
}

const identity = (raw: string | null) => raw ?? '';

/** The remembered stage positions and a reset. */
export function useChartPositions(): [Offsets, (next: Offsets | null) => void] {
  const [raw] = useStoredValue<string>(CHART_POSITIONS_KEY, identity);
  const offsets = useMemo(() => readOffsets(raw), [raw]);
  const set = useCallback((next: Offsets | null) => writeStored(CHART_POSITIONS_KEY, next ? JSON.stringify(next) : null), []);
  return [offsets, set];
}

interface FlowState {
  offsets: Offsets;
  onNodePointerDown: (node: Node, event: PointerEvent<SVGRectElement>) => void;
  onNodePointerMove: (event: PointerEvent<SVGRectElement>) => void;
  onNodePointerUp: (event: PointerEvent<SVGRectElement>) => void;
}

const FlowContext = createContext<FlowState | null>(null);

function useFlow(): FlowState {
  const state = useContext(FlowContext);
  if (!state) throw new Error('Flow layers render inside FlowChart.');
  return state;
}

const offsetOf = (offsets: Offsets, id: string) => offsets[id] ?? { x: 0, y: 0 };

/** A link as a band between two (possibly moved) nodes. */
function linkPath(link: Link, offsets: Offsets): string {
  const from = offsetOf(offsets, link.source.id);
  const to = offsetOf(offsets, link.target.id);
  const half = Math.max(1, link.thickness) / 2;
  const sx = link.source.x1 + from.x;
  const sy = link.pos0 + from.y;
  const tx = link.target.x0 + to.x;
  const ty = link.pos1 + to.y;
  const mx = (sx + tx) / 2;
  return [
    `M${sx},${sy - half}`,
    `C${mx},${sy - half} ${mx},${ty - half} ${tx},${ty - half}`,
    `L${tx},${ty + half}`,
    `C${mx},${ty + half} ${mx},${sy + half} ${sx},${sy + half}`,
    'Z',
  ].join(' ');
}

function LinksLayer({ links }: LayerProps) {
  const { offsets } = useFlow();
  return (
    <g>
      {links.map((link) => (
        <path
          key={`${link.source.id}-${link.target.id}`}
          d={linkPath(link, offsets)}
          fill={link.source.color}
          fillOpacity={0.32}
          className="transition-[fill-opacity] duration-150 hover:fill-opacity-60"
        >
          <title>{`${link.source.id} → ${link.target.id}: ${link.value}`}</title>
        </path>
      ))}
    </g>
  );
}

function NodesLayer({ nodes }: LayerProps) {
  const { offsets, onNodePointerDown, onNodePointerMove, onNodePointerUp } = useFlow();
  return (
    <g>
      {nodes.map((node) => {
        const offset = offsetOf(offsets, node.id);
        return (
          <rect
            key={node.id}
            data-stage={node.id}
            x={node.x + offset.x}
            y={node.y + offset.y}
            width={Math.max(node.width, 1)}
            height={Math.max(node.height, 2)}
            rx={3}
            fill={node.color}
            className="cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={(event) => onNodePointerDown(node, event)}
            onPointerMove={onNodePointerMove}
            onPointerUp={onNodePointerUp}
            onPointerCancel={onNodePointerUp}
          >
            <title>{`${node.id}: ${node.value}`}</title>
          </rect>
        );
      })}
    </g>
  );
}

function LabelsLayer({ nodes, width, margin }: LayerProps) {
  const { offsets } = useFlow();
  const innerWidth = width - (margin.left ?? 0) - (margin.right ?? 0);
  return (
    <g className="pointer-events-none select-none">
      {nodes.map((node) => {
        const offset = offsetOf(offsets, node.id);
        const left = node.x + offset.x < innerWidth / 2;
        const x = left ? node.x1 + offset.x + 10 : node.x + offset.x - 10;
        const y = node.y + offset.y + node.height / 2;
        return (
          <text key={node.id} x={x} y={y} dominantBaseline="central" textAnchor={left ? 'start' : 'end'} className="text-xs">
            <tspan className="fill-foreground font-semibold">{node.id}</tspan>
            <tspan className="fill-muted-foreground" dx={6}>
              {node.value}
            </tspan>
          </text>
        );
      })}
    </g>
  );
}

const LAYERS = [LinksLayer, NodesLayer, LabelsLayer];

export function FlowChart({ data, height = 420 }: { data: SankeyResponse; height?: number }) {
  const [offsets, setOffsets] = useChartPositions();
  const drag = useRef<{ id: string; pointer: number; startX: number; startY: number; base: { x: number; y: number } } | null>(null);
  const live = useRef<Offsets>(offsets);

  const chartData = useMemo(
    () => ({
      nodes: data.nodes.map((node) => ({ id: node.id, fill: node.color, fixedValue: node.value })),
      links: data.links.map((link) => ({ source: link.source, target: link.target, value: link.value })),
    }),
    [data],
  );

  const state = useMemo<FlowState>(
    () => ({
      offsets,
      onNodePointerDown(node, event) {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        live.current = offsets;
        drag.current = {
          id: node.id,
          pointer: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          base: offsetOf(offsets, node.id),
        };
      },
      onNodePointerMove(event) {
        const current = drag.current;
        if (!current || current.pointer !== event.pointerId) return;
        const next = {
          ...live.current,
          [current.id]: { x: current.base.x + event.clientX - current.startX, y: current.base.y + event.clientY - current.startY },
        };
        live.current = next;
        setOffsets(next);
      },
      onNodePointerUp(event) {
        if (drag.current?.pointer === event.pointerId) drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
    }),
    [offsets, setOffsets],
  );

  return (
    <FlowContext.Provider value={state}>
      <div style={{ height }} className="w-full">
        <ResponsiveSankey<FlowNode, FlowLink>
          data={chartData}
          margin={{ top: 16, right: 16, bottom: 16, left: 16 }}
          align="justify"
          sort="input"
          nodeThickness={14}
          nodeSpacing={22}
          nodeInnerPadding={0}
          colors={(node) => node.fill}
          layers={LAYERS}
          isInteractive={false}
          animate={false}
          role="img"
          ariaLabel={`Application flow: ${data.nodes.map((node) => `${node.id} ${node.value}`).join(', ')}`}
        />
      </div>
    </FlowContext.Provider>
  );
}
