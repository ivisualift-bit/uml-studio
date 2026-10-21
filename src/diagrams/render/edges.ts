import type { Point } from '@/domain/schemas/common';
import type { CommunicationMessage } from '@/domain/schemas/members';
import type { ModelElement, Relationship } from '@/domain/schemas/elements';
import type { ProjectDocument } from '@/domain/schemas/project';
import type { EdgeLabelKey, EdgeView, Routing, ViewStyle } from '@/domain/schemas/views';
import { formatGuard, formatTransitionLabel } from '@/domain/notation/labels';
import {
  center,
  distance,
  pointAlong,
  polylineLength,
  pointsToPath,
  trimEnd,
  trimStart,
  type ShapeOutline,
} from './geometry';
import type { Bounds, Primitive } from './primitives';
import { measureText } from './textMetrics';
import { BASE_FONT_SIZE, type DiagramTheme } from './theme';

export type MarkerKind =
  | 'none'
  | 'openArrow'
  | 'filledArrow'
  | 'hollowTriangle'
  | 'filledTriangle'
  | 'hollowDiamond'
  | 'filledDiamond'
  | 'cross';

export interface EdgeNotation {
  dashed: boolean;
  sourceMarker: MarkerKind;
  targetMarker: MarkerKind;
  labels: Partial<Record<EdgeLabelKey, string>>;
  underlineName?: boolean;
  assembly?: boolean;
  messages?: CommunicationMessage[];
}

const stereo = (text: string) => (text ? `«${text}»` : '');

function associationMarker(end: { aggregation: string; navigability: string }): MarkerKind {
  if (end.aggregation === 'composite') return 'filledDiamond';
  if (end.aggregation === 'shared') return 'hollowDiamond';
  if (end.navigability === 'navigable') return 'openArrow';
  if (end.navigability === 'nonNavigable') return 'cross';
  return 'none';
}

/** UML notation for a relationship (line style, end markers, label texts). */
export function edgeNotation(_doc: ProjectDocument, rel: Relationship): EdgeNotation {
  const userStereotype = rel.stereotype.trim();
  const keyword = (k: string) => stereo(userStereotype ? `${k}, ${userStereotype}` : k);
  const named = rel.name.trim();
  switch (rel.kind) {
    case 'association':
    case 'communicationPath':
    case 'link':
      return {
        dashed: false,
        sourceMarker: associationMarker(rel.sourceEnd),
        targetMarker: associationMarker(rel.targetEnd),
        underlineName: rel.kind === 'link',
        labels: {
          name: named,
          stereotype: stereo(userStereotype),
          sourceRole: rel.sourceEnd.name,
          sourceMultiplicity: rel.sourceEnd.multiplicity,
          targetRole: rel.targetEnd.name,
          targetMultiplicity: rel.targetEnd.multiplicity,
        },
      };
    case 'generalization':
      return {
        dashed: false,
        sourceMarker: 'none',
        targetMarker: 'hollowTriangle',
        labels: { name: named, stereotype: stereo(userStereotype) },
      };
    case 'realization':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'hollowTriangle',
        labels: { name: named, stereotype: stereo(userStereotype) },
      };
    case 'dependency':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: stereo(userStereotype) },
      };
    case 'include':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('include') },
      };
    case 'extend':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: {
          stereotype: keyword('extend'),
          name: [named, rel.condition.trim() ? `[${rel.condition.trim()}]` : ''].filter(Boolean).join(' '),
        },
      };
    case 'packageImport':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('import') },
      };
    case 'packageMerge':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('merge') },
      };
    case 'deployment':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('deploy') },
      };
    case 'manifestation':
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('manifest') },
      };
    case 'controlFlow':
    case 'objectFlow': {
      const parts = [
        named,
        formatGuard(rel.guard),
        rel.weight.trim() ? `{weight=${rel.weight.trim()}}` : '',
      ].filter(Boolean);
      return {
        dashed: false,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: parts.join(' '), stereotype: stereo(userStereotype) },
      };
    }
    case 'transition':
      return {
        dashed: false,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: formatTransitionLabel(rel) || named, stereotype: stereo(userStereotype) },
      };
    case 'connector':
      return {
        dashed: false,
        sourceMarker:
          rel.connectorKind === 'delegation'
            ? 'none'
            : associationMarker({ ...rel.sourceEnd, aggregation: 'none' }),
        targetMarker:
          rel.connectorKind === 'delegation'
            ? 'openArrow'
            : associationMarker({ ...rel.targetEnd, aggregation: 'none' }),
        assembly: rel.connectorKind === 'assembly',
        messages: rel.messages,
        labels: {
          name: named,
          stereotype: rel.connectorKind === 'delegation' ? keyword('delegate') : stereo(userStereotype),
          sourceRole: rel.sourceEnd.name,
          sourceMultiplicity: rel.sourceEnd.multiplicity,
          targetRole: rel.targetEnd.name,
          targetMultiplicity: rel.targetEnd.multiplicity,
        },
      };
    case 'extension':
      return {
        dashed: false,
        sourceMarker: 'none',
        targetMarker: 'filledTriangle',
        labels: { name: rel.isRequired ? '{required}' : named },
      };
    case 'informationFlow': {
      return {
        dashed: true,
        sourceMarker: 'none',
        targetMarker: 'openArrow',
        labels: { name: named, stereotype: keyword('flow') },
      };
    }
    default:
      return { dashed: false, sourceMarker: 'none', targetMarker: 'none', labels: { name: named } };
  }
}

/** Conveyed item names of an information flow (resolved at layout time). */
export function conveyedLabel(doc: ProjectDocument, rel: Relationship): string {
  if (rel.kind !== 'informationFlow') return '';
  return rel.conveyedIds
    .map((id) => doc.modelElements[id]?.name)
    .filter((n): n is string => !!n)
    .join(', ');
}

// -------------------------------------------------------------------------------------------------
// Geometry
// -------------------------------------------------------------------------------------------------

export interface EndpointShape {
  bounds: Bounds;
  outline: ShapeOutline;
}

function insideShape(shape: EndpointShape, p: Point): boolean {
  const { bounds: b, outline } = shape;
  const c = center(b);
  const hw = b.width / 2;
  const hh = b.height / 2;
  if (hw <= 0 || hh <= 0) return false;
  const dx = (p.x - c.x) / hw;
  const dy = (p.y - c.y) / hh;
  switch (outline) {
    case 'ellipse':
      return dx * dx + dy * dy <= 1;
    case 'circle': {
      const r = Math.min(hw, hh);
      return (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= r * r;
    }
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= 1;
    default:
      return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
  }
}

/** Where a ray starting inside the shape at `origin` towards `toward` crosses the outline. */
export function rayExit(shape: EndpointShape, origin: Point, toward: Point): Point {
  const dx = toward.x - origin.x;
  const dy = toward.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: origin.x, y: shape.bounds.y };
  const ux = dx / len;
  const uy = dy / len;
  if (!insideShape(shape, origin)) return origin;
  let lo = 0;
  let hi = Math.hypot(shape.bounds.width, shape.bounds.height) + 1;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (insideShape(shape, { x: origin.x + ux * mid, y: origin.y + uy * mid })) lo = mid;
    else hi = mid;
  }
  return { x: origin.x + ux * lo, y: origin.y + uy * lo };
}

function orthogonalRoute(s: Bounds, t: Bounds): Point[] {
  const sc = center(s);
  const tc = center(t);
  const overlapX = Math.min(s.x + s.width, t.x + t.width) - Math.max(s.x, t.x);
  const overlapY = Math.min(s.y + s.height, t.y + t.height) - Math.max(s.y, t.y);
  if (overlapX > 10) {
    const x = Math.max(s.x, t.x) + overlapX / 2;
    const down = tc.y > sc.y;
    return [
      { x, y: down ? s.y + s.height : s.y },
      { x, y: down ? t.y : t.y + t.height },
    ];
  }
  if (overlapY > 10) {
    const y = Math.max(s.y, t.y) + overlapY / 2;
    const right = tc.x > sc.x;
    return [
      { x: right ? s.x + s.width : s.x, y },
      { x: right ? t.x : t.x + t.width, y },
    ];
  }
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx > 0 ? s.x + s.width : s.x;
    const tx = dx > 0 ? t.x : t.x + t.width;
    const mx = (sx + tx) / 2;
    return [
      { x: sx, y: sc.y },
      { x: mx, y: sc.y },
      { x: mx, y: tc.y },
      { x: tx, y: tc.y },
    ];
  }
  const sy = dy > 0 ? s.y + s.height : s.y;
  const ty = dy > 0 ? t.y : t.y + t.height;
  const my = (sy + ty) / 2;
  return [
    { x: sc.x, y: sy },
    { x: sc.x, y: my },
    { x: tc.x, y: my },
    { x: tc.x, y: ty },
  ];
}

/** Insert elbows so consecutive points are axis aligned. */
function orthogonalize(points: Point[]): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const prev = result[result.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) result.push({ x: p.x, y: prev.y });
    result.push(p);
  }
  return result;
}

function selfLoop(b: Bounds, waypoints: Point[]): Point[] {
  const right = b.x + b.width;
  const startX = right - Math.min(24, b.width * 0.3);
  const endY = b.y + Math.min(24, b.height * 0.35);
  if (waypoints.length) return [{ x: startX, y: b.y }, ...waypoints, { x: right, y: endY }];
  return [
    { x: startX, y: b.y },
    { x: startX, y: b.y - 28 },
    { x: right + 28, y: b.y - 28 },
    { x: right + 28, y: endY },
    { x: right, y: endY },
  ];
}

export interface RouteInput {
  source: EndpointShape;
  target: EndpointShape;
  waypoints: Point[];
  routing: Routing;
  isSelf: boolean;
  /** Perpendicular offset (px) separating parallel edges between the same pair of nodes. */
  parallelOffset: number;
}

/** Full polyline from the source outline to the target outline. */
export function routeEdge(input: RouteInput): Point[] {
  const { source, target, waypoints } = input;
  if (input.isSelf) return selfLoop(source.bounds, waypoints);
  const sc = center(source.bounds);
  const tc = center(target.bounds);
  if (input.routing === 'orthogonal') {
    if (waypoints.length === 0) return orthogonalRoute(source.bounds, target.bounds);
    const inner = orthogonalize([sc, ...waypoints, tc]).slice(1, -1);
    const first = inner[0] ?? tc;
    const last = inner[inner.length - 1] ?? sc;
    const start = rayExit(source, sc, first);
    const end = rayExit(target, tc, last);
    return orthogonalize([start, ...inner, end]);
  }
  if (waypoints.length === 0 && input.parallelOffset !== 0) {
    const len = distance(sc, tc) || 1;
    const nx = -(tc.y - sc.y) / len;
    const ny = (tc.x - sc.x) / len;
    const so = { x: sc.x + nx * input.parallelOffset, y: sc.y + ny * input.parallelOffset };
    const to = { x: tc.x + nx * input.parallelOffset, y: tc.y + ny * input.parallelOffset };
    if (insideShape(source, so) && insideShape(target, to))
      return [rayExit(source, so, to), rayExit(target, to, so)];
  }
  const first = waypoints[0] ?? tc;
  const last = waypoints[waypoints.length - 1] ?? sc;
  return [rayExit(source, sc, first), ...waypoints, rayExit(target, tc, last)];
}

// -------------------------------------------------------------------------------------------------
// Markers
// -------------------------------------------------------------------------------------------------

/** Length of a marker along the line (the line is trimmed by this for closed markers). */
export function markerLength(kind: MarkerKind): number {
  switch (kind) {
    case 'hollowTriangle':
    case 'filledTriangle':
      return 14;
    case 'hollowDiamond':
    case 'filledDiamond':
      return 18;
    case 'filledArrow':
      return 11;
    default:
      return 0;
  }
}

/** Marker primitives with the tip at `tip`, pointing along `angle` (radians, direction of travel). */
export function markerPrimitives(
  kind: MarkerKind,
  tip: Point,
  angle: number,
  color: string,
  background: string,
  strokeWidth: number,
): Primitive[] {
  const back = (d: number, side: number): Point => ({
    x: tip.x - Math.cos(angle) * d - Math.sin(angle) * side,
    y: tip.y - Math.sin(angle) * d + Math.cos(angle) * side,
  });
  switch (kind) {
    case 'openArrow':
      return [
        {
          type: 'polyline',
          points: [back(12, -6), tip, back(12, 6)],
          stroke: color,
          strokeWidth,
          fill: 'none',
        },
      ];
    case 'filledArrow':
      return [
        {
          type: 'polygon',
          points: [tip, back(11, -5), back(11, 5)],
          fill: color,
          stroke: color,
          strokeWidth,
        },
      ];
    case 'hollowTriangle':
    case 'filledTriangle':
      return [
        {
          type: 'polygon',
          points: [tip, back(14, -8), back(14, 8)],
          fill: kind === 'filledTriangle' ? color : background,
          stroke: color,
          strokeWidth,
        },
      ];
    case 'hollowDiamond':
    case 'filledDiamond':
      return [
        {
          type: 'polygon',
          points: [tip, back(9, -6), back(18, 0), back(9, 6)],
          fill: kind === 'filledDiamond' ? color : background,
          stroke: color,
          strokeWidth,
        },
      ];
    case 'cross': {
      const c = back(10, 0);
      const d = 4.5;
      return [
        { type: 'line', x1: c.x - d, y1: c.y - d, x2: c.x + d, y2: c.y + d, stroke: color, strokeWidth },
        { type: 'line', x1: c.x + d, y1: c.y - d, x2: c.x - d, y2: c.y + d, stroke: color, strokeWidth },
      ];
    }
    default:
      return [];
  }
}

// -------------------------------------------------------------------------------------------------
// Edge layout
// -------------------------------------------------------------------------------------------------

export interface EdgeLabelLayout {
  key: EdgeLabelKey;
  text: string;
  /** Baseline anchor point (absolute, user offset applied). */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  bounds: Bounds;
  underline?: boolean;
}

export interface EdgeLayout {
  points: Point[];
  primitives: Primitive[];
  labels: EdgeLabelLayout[];
  path: string;
}

export interface EdgeLayoutInput {
  doc: ProjectDocument;
  relationship: Relationship;
  view: Pick<EdgeView, 'labelOffsets' | 'style'>;
  points: Point[];
  theme: DiagramTheme;
  extraName?: string;
  /** Realization drawn to an interface in ball notation: a plain solid line (UML provided interface). */
  providedInterfaceBall?: boolean;
}

const LABEL_SIZE = BASE_FONT_SIZE - 1;

function labelBox(
  x: number,
  y: number,
  value: string,
  size: number,
  anchor: 'start' | 'middle' | 'end',
): Bounds {
  const w = measureText(value, size);
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
  return { x: left - 2, y: y - size, width: w + 4, height: size * 1.35 };
}

export function layoutEdge(input: EdgeLayoutInput): EdgeLayout {
  const { relationship: rel, points, theme } = input;
  const base = edgeNotation(input.doc, rel);
  const notation: EdgeNotation = input.providedInterfaceBall
    ? { ...base, dashed: false, targetMarker: 'none' }
    : base;
  const style: ViewStyle = input.view.style;
  const color = style.stroke ?? theme.edge;
  const textColor = style.textColor ?? theme.text;
  const sw = style.lineWidth ?? 1.2;
  const fontSize = style.fontSize ?? LABEL_SIZE;
  const primitives: Primitive[] = [];

  let line = points;
  const startCut = markerLength(notation.sourceMarker);
  const endCut = markerLength(notation.targetMarker);
  if (endCut) line = trimEnd(line, endCut);
  if (startCut) line = trimStart(line, startCut);
  primitives.push({
    type: 'polyline',
    points: line,
    stroke: color,
    strokeWidth: sw,
    dash: notation.dashed ? '7 5' : undefined,
    fill: 'none',
  });

  const n = points.length;
  if (n >= 2) {
    const tip = points[n - 1]!;
    const prev = points[n - 2]!;
    primitives.push(
      ...markerPrimitives(
        notation.targetMarker,
        tip,
        Math.atan2(tip.y - prev.y, tip.x - prev.x),
        color,
        theme.background,
        sw,
      ),
    );
    const sTip = points[0]!;
    const sNext = points[1]!;
    primitives.push(
      ...markerPrimitives(
        notation.sourceMarker,
        sTip,
        Math.atan2(sTip.y - sNext.y, sTip.x - sNext.x),
        color,
        theme.background,
        sw,
      ),
    );
  }

  if (notation.assembly && n >= 2) {
    const mid = pointAlong(points, polylineLength(points) / 2);
    const r = 6;
    const ux = Math.cos(mid.angle);
    const uy = Math.sin(mid.angle);
    const ball = { x: mid.point.x + ux * 3, y: mid.point.y + uy * 3 };
    primitives.push({
      type: 'ellipse',
      cx: ball.x,
      cy: ball.y,
      rx: r,
      ry: r,
      fill: theme.background,
      stroke: color,
      strokeWidth: sw,
    });
    // Socket: arc of radius r+4 opening towards the ball.
    const R = r + 4;
    const a0 = mid.angle + Math.PI / 2;
    const a1 = mid.angle - Math.PI / 2;
    const p0 = { x: ball.x + Math.cos(a0) * R, y: ball.y + Math.sin(a0) * R };
    const p1 = { x: ball.x + Math.cos(a1) * R, y: ball.y + Math.sin(a1) * R };
    primitives.push({
      type: 'path',
      d: `M${p0.x} ${p0.y} A${R} ${R} 0 0 0 ${p1.x} ${p1.y}`,
      fill: 'none',
      stroke: color,
      strokeWidth: sw,
      box: { x: ball.x - R, y: ball.y - R, width: R * 2, height: R * 2 },
    });
  }

  const labels: EdgeLabelLayout[] = [];
  const offsetOf = (key: EdgeLabelKey) => input.view.labelOffsets[key] ?? { x: 0, y: 0 };
  const push = (
    key: EdgeLabelKey,
    value: string,
    x: number,
    y: number,
    anchor: 'start' | 'middle' | 'end',
    underline?: boolean,
  ) => {
    if (!value) return;
    const off = offsetOf(key);
    const lx = x + off.x;
    const ly = y + off.y;
    labels.push({
      key,
      text: value,
      x: lx,
      y: ly,
      anchor,
      bounds: labelBox(lx, ly, value, fontSize, anchor),
      underline,
    });
  };

  if (n >= 2) {
    const mid = pointAlong(points, polylineLength(points) / 2);
    const nx = -Math.sin(mid.angle);
    const ny = Math.cos(mid.angle);
    // Put the centre label on the "upper" side of the line.
    const side = ny > 0 || (ny === 0 && nx < 0) ? -1 : 1;
    const ox = nx * side;
    const oy = ny * side;
    const nameText = [notation.labels.name, input.extraName].filter(Boolean).join(' ');
    const horizontalish = Math.abs(Math.cos(mid.angle)) > 0.5;
    const anchor = horizontalish ? 'middle' : ox > 0 ? 'start' : 'end';
    push(
      'name',
      nameText,
      mid.point.x + ox * 10,
      mid.point.y + oy * 10 + (horizontalish ? -2 : 4),
      anchor,
      notation.underlineName,
    );
    const stereoY = mid.point.y + oy * 10 + (horizontalish ? -2 : 4) - (nameText ? fontSize * 1.25 : 0);
    push('stereotype', notation.labels.stereotype ?? '', mid.point.x + ox * 10, stereoY, anchor);

    if (notation.messages?.length) {
      const along = { x: Math.cos(mid.angle), y: Math.sin(mid.angle) };
      const base = { x: mid.point.x - ox * 16, y: mid.point.y - oy * 16 + (horizontalish ? fontSize : 0) };
      notation.messages.forEach((m, i) => {
        const label = `${m.sequence ? `${m.sequence}: ` : ''}${m.name}`;
        const y = base.y + i * fontSize * 1.4;
        labels.push({
          key: 'name',
          text: '',
          x: base.x,
          y,
          anchor: 'middle',
          bounds: labelBox(base.x, y, label, fontSize, 'middle'),
        });
        primitives.push({
          type: 'text',
          x: base.x,
          y,
          text: label,
          fontSize,
          anchor: 'middle',
          fill: textColor,
        });
        const dir = m.direction === 'forward' ? 1 : -1;
        const ax = base.x - (measureText(label, fontSize) / 2 + 18) * along.x;
        const ay = y - fontSize * 0.35 - (measureText(label, fontSize) / 2 + 18) * along.y;
        const tail = { x: ax - along.x * 8 * dir, y: ay - along.y * 8 * dir };
        const tip = { x: ax + along.x * 8 * dir, y: ay + along.y * 8 * dir };
        primitives.push({
          type: 'line',
          x1: tail.x,
          y1: tail.y,
          x2: tip.x,
          y2: tip.y,
          stroke: color,
          strokeWidth: 1,
        });
        primitives.push(
          ...markerPrimitives(
            m.sort === 'asynchronous' ? 'openArrow' : 'filledArrow',
            tip,
            Math.atan2(tip.y - tail.y, tip.x - tail.x),
            color,
            theme.background,
            1,
          ),
        );
      });
    }

    /**
     * End labels sit a little way along the edge (past any marker) on either side of the line, and are
     * anchored so the text extends AWAY from the node — never over the shape or the arrowhead.
     */
    const endLabels = (which: 'source' | 'target') => {
      const pts = which === 'source' ? points : points.slice().reverse();
      const marker = which === 'source' ? notation.sourceMarker : notation.targetMarker;
      const d = Math.max(10, markerLength(marker) + 6);
      const at = pointAlong(pts, Math.min(d, polylineLength(pts) / 2));
      const ux = Math.cos(at.angle);
      const uy = Math.sin(at.angle);
      const horizontal = Math.abs(ux) >= Math.abs(uy);
      const place = (side: 1 | -1): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } => {
        if (horizontal) {
          const above = side < 0;
          return {
            x: at.point.x,
            y: above ? at.point.y - 5 : at.point.y + fontSize + 2,
            anchor: ux > 0 ? 'start' : 'end',
          };
        }
        const right = side > 0;
        return {
          x: at.point.x + (right ? 6 : -6),
          y: at.point.y + (uy > 0 ? fontSize * 0.9 : -2),
          anchor: right ? 'start' : 'end',
        };
      };
      const role = which === 'source' ? notation.labels.sourceRole : notation.labels.targetRole;
      const mult =
        which === 'source' ? notation.labels.sourceMultiplicity : notation.labels.targetMultiplicity;
      const r = place(-1);
      const m = place(1);
      push(which === 'source' ? 'sourceRole' : 'targetRole', role ?? '', r.x, r.y, r.anchor);
      push(which === 'source' ? 'sourceMultiplicity' : 'targetMultiplicity', mult ?? '', m.x, m.y, m.anchor);
    };
    endLabels('source');
    endLabels('target');
  }

  for (const l of labels) {
    if (!l.text) continue;
    primitives.push({
      type: 'text',
      x: l.x,
      y: l.y,
      text: l.text,
      fontSize,
      anchor: l.anchor,
      fill: textColor,
      underline: l.underline,
      hit: { label: l.key },
    });
  }
  return { points, primitives, labels: labels.filter((l) => l.text), path: pointsToPath(points) };
}

/** Elements → endpoint shape helper used by graph layout (kept here for reuse in tests). */
export function isSelfRelationship(rel: ModelElement): boolean {
  return 'sourceId' in rel && rel.sourceId === rel.targetId;
}
