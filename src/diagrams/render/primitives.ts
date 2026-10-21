import type { Point } from '@/domain/schemas/common';
import { measureText } from './textMetrics';

/**
 * Minimal vector scene graph. Shapes are emitted as these primitives by the notation layer and then
 * either rendered as React SVG elements (canvas) or serialized to SVG text (export). Arrowheads and
 * diamonds are explicit polygons, never `<marker>` references.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Stroke {
  stroke: string;
  strokeWidth: number;
  dash?: string;
}

export interface Hit {
  /** Canvas-only hit-testing metadata (`data-*` attributes); not serialized to export. */
  hit?: Record<string, string>;
}

export type Primitive =
  | ({ type: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill: string } & Stroke & Hit)
  | ({ type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string } & Stroke & Hit)
  | ({ type: 'line'; x1: number; y1: number; x2: number; y2: number } & Stroke & Hit)
  | ({ type: 'polyline'; points: Point[]; fill?: string } & Stroke & Hit)
  | ({ type: 'polygon'; points: Point[]; fill: string } & Stroke & Hit)
  | ({ type: 'path'; d: string; fill: string; box: Bounds } & Stroke & Hit)
  | ({
      type: 'text';
      x: number;
      /** Baseline y. */
      y: number;
      text: string;
      fontSize: number;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      anchor: 'start' | 'middle' | 'end';
      fill: string;
    } & Hit)
  | { type: 'group'; dx: number; dy: number; children: Primitive[] };

export function translate(primitives: Primitive[], dx: number, dy: number): Primitive {
  return { type: 'group', dx, dy, children: primitives };
}

export function emptyBounds(): Bounds {
  return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, width: Number.NEGATIVE_INFINITY, height: Number.NEGATIVE_INFINITY };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function pointsBounds(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function textBounds(p: Extract<Primitive, { type: 'text' }>): Bounds {
  const width = measureText(p.text, p.fontSize, p.bold);
  const x = p.anchor === 'start' ? p.x : p.anchor === 'middle' ? p.x - width / 2 : p.x - width;
  return { x, y: p.y - p.fontSize * 0.8, width, height: p.fontSize * 1.05 };
}

/** Bounding box of primitives (stroke width included) — used for export content bounds. */
export function primitivesBounds(primitives: Primitive[], dx = 0, dy = 0): Bounds | null {
  let result: Bounds | null = null;
  const grow = (b: Bounds | null, sw = 0) => {
    if (!b) return;
    result = unionBounds(result, { x: b.x + dx - sw / 2, y: b.y + dy - sw / 2, width: b.width + sw, height: b.height + sw });
  };
  for (const p of primitives) {
    switch (p.type) {
      case 'rect':
        grow({ x: p.x, y: p.y, width: p.width, height: p.height }, p.strokeWidth);
        break;
      case 'ellipse':
        grow({ x: p.cx - p.rx, y: p.cy - p.ry, width: p.rx * 2, height: p.ry * 2 }, p.strokeWidth);
        break;
      case 'line':
        grow(pointsBounds([{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }]), p.strokeWidth);
        break;
      case 'polyline':
      case 'polygon':
        grow(pointsBounds(p.points), p.strokeWidth);
        break;
      case 'path':
        grow(p.box, p.strokeWidth);
        break;
      case 'text':
        if (p.text) grow(textBounds(p));
        break;
      case 'group':
        result = unionBounds(result, primitivesBounds(p.children, dx + p.dx, dy + p.dy));
        break;
      default:
        break;
    }
  }
  return result;
}
