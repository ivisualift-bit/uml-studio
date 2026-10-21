import { memo, type ReactNode } from 'react';
import type { Primitive } from '@/diagrams/render/primitives';
import { underlineFor } from '@/diagrams/render/svgSerializer';
import { DIAGRAM_FONT_FAMILY } from '@/diagrams/render/textMetrics';

function dataAttrs(hit: Record<string, string> | undefined): Record<string, string> {
  if (!hit) return {};
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(hit)) attrs[`data-${k}`] = v;
  return attrs;
}

function renderPrimitive(p: Primitive, key: number): ReactNode {
  switch (p.type) {
    case 'rect':
      return (
        <rect
          key={key}
          x={p.x}
          y={p.y}
          width={Math.max(0, p.width)}
          height={Math.max(0, p.height)}
          rx={p.rx}
          fill={p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeDasharray={p.dash}
          {...dataAttrs(p.hit)}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          key={key}
          cx={p.cx}
          cy={p.cy}
          rx={Math.max(0, p.rx)}
          ry={Math.max(0, p.ry)}
          fill={p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeDasharray={p.dash}
          {...dataAttrs(p.hit)}
        />
      );
    case 'line':
      return (
        <line
          key={key}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeDasharray={p.dash}
          {...dataAttrs(p.hit)}
        />
      );
    case 'polyline':
      return (
        <polyline
          key={key}
          points={p.points.map((q) => `${q.x},${q.y}`).join(' ')}
          fill={p.fill ?? 'none'}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeDasharray={p.dash}
          strokeLinejoin="round"
          {...dataAttrs(p.hit)}
        />
      );
    case 'polygon':
      return (
        <polygon
          key={key}
          points={p.points.map((q) => `${q.x},${q.y}`).join(' ')}
          fill={p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          {...dataAttrs(p.hit)}
        />
      );
    case 'path':
      return (
        <path
          key={key}
          d={p.d}
          fill={p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeDasharray={p.dash}
          {...dataAttrs(p.hit)}
        />
      );
    case 'text': {
      if (!p.text) return null;
      const underline = underlineFor(p);
      return (
        <g key={key}>
          <text
            x={p.x}
            y={p.y}
            fontSize={p.fontSize}
            fill={p.fill}
            textAnchor={p.anchor}
            fontWeight={p.bold ? 'bold' : undefined}
            fontStyle={p.italic ? 'italic' : undefined}
            style={{ whiteSpace: 'pre' }}
            {...dataAttrs(p.hit)}
          >
            {p.text}
          </text>
          {underline && (
            <line
              x1={underline.x1}
              y1={underline.y1}
              x2={underline.x2}
              y2={underline.y2}
              stroke={underline.stroke}
              strokeWidth={underline.strokeWidth}
            />
          )}
        </g>
      );
    }
    case 'group':
      return (
        <g key={key} transform={`translate(${p.dx} ${p.dy})`}>
          {p.children.map(renderPrimitive)}
        </g>
      );
    default:
      return null;
  }
}

/** Renders notation primitives exactly as the SVG exporter serializes them. */
export const PrimitiveSvg = memo(function PrimitiveSvg({ primitives }: { primitives: Primitive[] }) {
  return <g fontFamily={DIAGRAM_FONT_FAMILY}>{primitives.map(renderPrimitive)}</g>;
});
