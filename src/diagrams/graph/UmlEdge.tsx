import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { Point } from '@/domain/schemas/common';
import type { EdgeLabelKey } from '@/domain/schemas/views';
import type { GraphEdgeRender } from '@/diagrams/render/graphLayout';
import type { Primitive } from '@/diagrams/render/primitives';
import { PrimitiveSvg } from '@/diagrams/shared/PrimitiveSvg';
import { useGraphCanvas } from './canvasContext';

export type UmlEdgeData = { render: GraphEdgeRender };
export type UmlEdgeType = Edge<UmlEdgeData, 'uml'>;

type DragKind =
  | { type: 'waypoint'; index: number }
  | { type: 'insert'; index: number }
  | { type: 'label'; key: EdgeLabelKey; start: Point; base: Point }
  | { type: 'endpoint'; end: 'source' | 'target' };

const EMPTY_POINTS: Point[] = [];

interface PointerLike {
  clientX: number;
  clientY: number;
}

function UmlEdgeImpl({ id, data, selected }: EdgeProps<UmlEdgeType>) {
  const ctx = useGraphCanvas();
  const drag = useRef<DragKind | null>(null);
  const moved = useRef(false);
  const [labelShift, setLabelShift] = useState<{
    key: EdgeLabelKey;
    dx: number;
    dy: number;
    offset: Point;
  } | null>(null);
  /** Latest drag handlers; window listeners call through this so re-renders never break a drag. */
  const handlers = useRef<{ move: (e: PointerLike) => void; up: (e: PointerLike) => void } | null>(null);
  const render = data?.render;
  const primitives = render?.layout.primitives;
  const split = useMemo(() => {
    if (!primitives || !labelShift) return { still: primitives ?? [], moving: [] as Primitive[] };
    const isMoving = (p: Primitive) => p.type === 'text' && p.hit?.label === labelShift.key;
    return { still: primitives.filter((p) => !isMoving(p)), moving: primitives.filter(isMoving) };
  }, [primitives, labelShift]);
  if (!render) return null;

  const { layout } = render;
  const isNoteLink = render.view.kind === 'noteLink';
  const waypoints = render.view.waypoints ?? EMPTY_POINTS;
  const points = layout.points;
  const editable = ctx.interactive && !!selected && ctx.singleSelection;
  const straight = isNoteLink || (render.view.kind === 'edge' && render.view.routing === 'straight');

  const begin = (e: ReactPointerEvent, kind: DragKind) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = kind;
    moved.current = false;
    const move = (ev: PointerEvent) => handlers.current?.move(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      handlers.current?.up(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onMove = (e: PointerLike) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    const p = ctx.screenToFlow({ x: e.clientX, y: e.clientY });
    const rounded = { x: Math.round(p.x), y: Math.round(p.y) };
    if (d.type === 'waypoint') {
      const next = waypoints.slice();
      next[d.index] = rounded;
      ctx.setTransientWaypoints(id, next);
    } else if (d.type === 'insert') {
      const next = waypoints.slice();
      next.splice(d.index, 0, rounded);
      ctx.setTransientWaypoints(id, next);
    } else if (d.type === 'label') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      setLabelShift({
        key: d.key,
        dx,
        dy,
        offset: { x: Math.round(d.base.x + dx), y: Math.round(d.base.y + dy) },
      });
    } else {
      const anchor = d.end === 'source' ? points[points.length - 1]! : points[0]!;
      ctx.setReconnectPreview({ from: anchor, to: p });
    }
  };

  const onUp = (e: PointerLike) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = ctx.screenToFlow({ x: e.clientX, y: e.clientY });
    const rounded = { x: Math.round(p.x), y: Math.round(p.y) };
    if (d.type === 'waypoint' && moved.current) {
      const next = waypoints.slice();
      next[d.index] = rounded;
      ctx.commitWaypoints(id, next);
    } else if (d.type === 'insert' && moved.current) {
      const next = waypoints.slice();
      next.splice(d.index, 0, rounded);
      ctx.commitWaypoints(id, next);
    } else if (d.type === 'label') {
      if (labelShift && moved.current) ctx.commitLabelOffset(id, d.key, labelShift.offset);
      setLabelShift(null);
    } else if (d.type === 'endpoint') {
      ctx.setReconnectPreview(null);
      const nodeEl = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((el) => el.closest('.react-flow__node'))
        .find((el): el is Element => !!el);
      const nodeId = nodeEl?.getAttribute('data-id');
      if (nodeId && moved.current) ctx.reconnect(id, d.end, nodeId);
    }
    ctx.setTransientWaypoints(id, null);
  };

  const onLabelPointerDown = (e: ReactPointerEvent) => {
    const key = (e.target as Element).getAttribute('data-label') as EdgeLabelKey | null;
    if (!key || !editable || isNoteLink) return;
    const p = ctx.screenToFlow({ x: e.clientX, y: e.clientY });
    const base = (render.view.kind === 'edge' ? render.view.labelOffsets[key] : undefined) ?? { x: 0, y: 0 };
    begin(e, { type: 'label', key, start: p, base });
  };

  handlers.current = { move: onMove, up: onUp };

  const removeWaypoint = (index: number) => {
    const next = waypoints.slice();
    next.splice(index, 1);
    ctx.commitWaypoints(id, next);
  };

  const chain: Point[] =
    straight && points.length >= 2 ? [points[0]!, ...waypoints, points[points.length - 1]!] : [];
  // React Flow sets `pointer-events: visibleStroke` on edges; handles must opt in to fill hits.
  const handle = { className: 'nodrag nopan', pointerEvents: 'all' as const };

  return (
    <g
      data-edge-id={id}
      data-testid="uml-edge"
      data-kind={render.relationship?.kind ?? 'noteLink'}
      data-selected={selected ? 'true' : 'false'}
      onPointerDown={onLabelPointerDown}
    >
      {selected && (
        <path
          d={layout.path}
          fill="none"
          stroke="var(--selection)"
          strokeOpacity={0.28}
          strokeWidth={7}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      <path
        d={layout.path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="react-flow__edge-interaction"
      />
      <PrimitiveSvg primitives={split.still} />
      {labelShift && (
        <g transform={`translate(${labelShift.dx} ${labelShift.dy})`}>
          <PrimitiveSvg primitives={split.moving} />
        </g>
      )}
      {layout.labels.map((l) => (
        <rect
          key={l.key}
          x={l.bounds.x}
          y={l.bounds.y}
          width={l.bounds.width}
          height={l.bounds.height}
          fill="transparent"
          data-label={l.key}
          data-testid={`edge-label-${l.key}`}
          pointerEvents="all"
          style={{ cursor: editable ? 'move' : 'pointer' }}
        />
      ))}
      {editable && (
        <>
          {waypoints.map((p, i) => (
            <circle
              key={`w${i}`}
              cx={p.x}
              cy={p.y}
              r={4.5}
              fill="var(--surface-1)"
              stroke="var(--selection)"
              strokeWidth={1.5}
              style={{ cursor: 'move' }}
              data-testid="edge-waypoint"
              onPointerDown={(e) => begin(e, { type: 'waypoint', index: i })}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeWaypoint(i);
              }}
              {...handle}
            />
          ))}
          {chain.slice(1).map((p, i) => {
            const a = chain[i]!;
            if (Math.hypot(p.x - a.x, p.y - a.y) < 30) return null;
            const m = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
            return (
              <rect
                key={`m${i}`}
                x={m.x - 3.5}
                y={m.y - 3.5}
                width={7}
                height={7}
                fill="var(--selection)"
                fillOpacity={0.55}
                style={{ cursor: 'copy' }}
                data-testid="edge-midpoint"
                onPointerDown={(e) => begin(e, { type: 'insert', index: i })}
                {...handle}
              />
            );
          })}
          {!isNoteLink &&
            (['source', 'target'] as const).map((end) => {
              const p = end === 'source' ? points[0]! : points[points.length - 1]!;
              return (
                <circle
                  key={end}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill="var(--selection)"
                  stroke="var(--surface-1)"
                  strokeWidth={1.5}
                  style={{ cursor: 'crosshair' }}
                  data-testid={`edge-${end}-handle`}
                  onPointerDown={(e) => begin(e, { type: 'endpoint', end })}
                  {...handle}
                />
              );
            })}
        </>
      )}
    </g>
  );
}

export const UmlEdge = memo(UmlEdgeImpl);
