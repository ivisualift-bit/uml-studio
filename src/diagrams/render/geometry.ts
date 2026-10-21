import type { Point } from '@/domain/schemas/common';
import type { Bounds } from './primitives';

export type ShapeOutline = 'rect' | 'ellipse' | 'diamond' | 'circle';

export const center = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointInBounds(p: Point, b: Bounds, slack = 0): boolean {
  return (
    p.x >= b.x - slack && p.x <= b.x + b.width + slack && p.y >= b.y - slack && p.y <= b.y + b.height + slack
  );
}

/**
 * Point where the ray from the shape centre towards `toward` exits the shape outline.
 * Used to dock edge endpoints on the visible outline (markers then sit outside the shape).
 */
export function outlineIntersection(bounds: Bounds, outline: ShapeOutline, toward: Point): Point {
  const c = center(bounds);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: bounds.y };
  const hw = bounds.width / 2;
  const hh = bounds.height / 2;
  switch (outline) {
    case 'ellipse':
    case 'circle': {
      const rx = outline === 'circle' ? Math.min(hw, hh) : hw;
      const ry = outline === 'circle' ? Math.min(hw, hh) : hh;
      const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    case 'diamond': {
      const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    default: {
      const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
      const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
  }
}

export function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1]!, points[i]!);
  return length;
}

/** Point at distance `d` along the polyline with the direction of its segment. */
export function pointAlong(points: Point[], d: number): { point: Point; angle: number } {
  let remaining = Math.max(0, d);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = distance(a, b);
    if (remaining <= len || i === points.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, remaining / len);
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    remaining -= len;
  }
  const p = points[0] ?? { x: 0, y: 0 };
  return { point: p, angle: 0 };
}

export function midpointAlong(points: Point[]): { point: Point; angle: number } {
  return pointAlong(points, polylineLength(points) / 2);
}

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Index of the segment of `points` closest to p (for inserting a bend point). */
export function closestSegment(points: Point[], p: Point): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const d = distanceToSegment(p, points[i - 1]!, points[i]!);
    if (d < bestDistance) {
      bestDistance = d;
      best = i - 1;
    }
  }
  return best;
}

export function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Shrink the polyline end by `amount` (so closed markers are not crossed by the line). */
export function trimEnd(points: Point[], amount: number): Point[] {
  if (points.length < 2 || amount <= 0) return points;
  const result = points.slice();
  const last = result[result.length - 1]!;
  const prev = result[result.length - 2]!;
  const len = distance(prev, last);
  if (len <= amount) return result;
  const t = (len - amount) / len;
  result[result.length - 1] = { x: prev.x + (last.x - prev.x) * t, y: prev.y + (last.y - prev.y) * t };
  return result;
}

export function trimStart(points: Point[], amount: number): Point[] {
  return trimEnd(points.slice().reverse(), amount).reverse();
}
