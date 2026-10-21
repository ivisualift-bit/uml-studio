import type { ID, Point } from '@/domain/schemas/common';
import type { ElementOf } from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import type {
  ActivationView,
  FragmentView,
  LifelineView,
  MessageView,
  NoteView,
} from '@/domain/schemas/views';
import { formatMessageLabel } from '@/domain/notation/labels';
import { markerPrimitives } from './edges';
import { trimEnd } from './geometry';
import { layoutNote, type NodeLayout } from './nodeShapes';
import { primitivesBounds, unionBounds, type Bounds, type Primitive } from './primitives';
import { LINE_HEIGHT, measureText } from './textMetrics';
import { BASE_FONT_SIZE, resolveStyle, type DiagramTheme } from './theme';

export const ACTIVATION_WIDTH = 12;
export const SELF_LOOP_WIDTH = 32;
export const FOUND_LOST_LENGTH = 110;

export interface LifelineRender {
  view: LifelineView;
  element: ElementOf<'lifeline'>;
  x: number;
  headBox: Bounds;
  lineTop: number;
  lineBottom: number;
  destroyedAt: number | null;
  primitives: Primitive[];
  label: string;
}

export interface ActivationRender {
  view: ActivationView;
  box: Bounds;
  depth: number;
  primitives: Primitive[];
}

export interface MessageRender {
  view: MessageView;
  element: ElementOf<'message'>;
  points: Point[];
  labelText: string;
  labelBounds: Bounds;
  number: number;
  primitives: Primitive[];
}

export interface FragmentRender {
  view: FragmentView;
  element: ElementOf<'combinedFragment'>;
  box: Bounds;
  tagBox: Bounds;
  operands: Array<{ id: ID; top: number; bottom: number; guardBox: Bounds }>;
  /** Frame and dividers (drawn below lifelines). */
  primitives: Primitive[];
  /** Operator tag and guards (drawn above lifelines and activations so they stay readable). */
  overlay: Primitive[];
}

export interface NoteRender {
  view: NoteView;
  layout: NodeLayout;
}

export interface SequenceLayout {
  lifelines: Map<ID, LifelineRender>;
  activations: Map<ID, ActivationRender>;
  messages: Map<ID, MessageRender>;
  fragments: Map<ID, FragmentRender>;
  notes: Map<ID, NoteRender>;
  orderedMessageIds: ID[];
  bottom: number;
  primitives: Primitive[];
  bounds: Bounds | null;
}

export interface SequenceOverrides {
  lifelineX?: ReadonlyMap<ID, number>;
  messageY?: ReadonlyMap<ID, { sendY: number; receiveY: number }>;
  messageLabel?: ReadonlyMap<ID, Point>;
  activation?: ReadonlyMap<ID, { startY: number; endY: number }>;
  fragment?: ReadonlyMap<
    ID,
    { x: number; y: number; width: number; height: number; operandYs?: Record<ID, number> }
  >;
  note?: ReadonlyMap<ID, { x: number; y: number; width?: number; height?: number }>;
}

/** Message order = vertical send position, ties broken by id (deterministic). */
export function orderMessages(views: MessageView[]): MessageView[] {
  return views.slice().sort((a, b) => a.sendY - b.sendY || a.id.localeCompare(b.id));
}

function lifelineLabel(doc: ProjectDocument, el: ElementOf<'lifeline'>): string {
  const typeName = el.typeElementId
    ? (doc.modelElements[el.typeElementId]?.name ?? el.typeName)
    : el.typeName;
  if (typeName) return `${el.name}${el.name ? ' ' : ''}: ${typeName}`.trim();
  return el.name || ':';
}

export function layoutSequence(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  theme: DiagramTheme,
  overrides: SequenceOverrides = {},
): SequenceLayout {
  const views = Object.values(diagram.views);
  const lifelineViews = views.filter((v): v is LifelineView => v.kind === 'lifeline');
  const messageViews = orderMessages(
    views
      .filter((v): v is MessageView => v.kind === 'message')
      .map((v) => {
        const o = overrides.messageY?.get(v.id);
        const label = overrides.messageLabel?.get(v.id);
        return o || label ? { ...v, ...o, ...(label ? { labelOffset: label } : {}) } : v;
      }),
  );
  const activationViews = views
    .filter((v): v is ActivationView => v.kind === 'activation')
    .map((v) => {
      const o = overrides.activation?.get(v.id);
      return o ? { ...v, ...o } : v;
    });
  const fragmentViews = views
    .filter((v): v is FragmentView => v.kind === 'fragment')
    .map((v) => {
      const o = overrides.fragment?.get(v.id);
      return o ? { ...v, ...o, operandYs: o.operandYs ?? v.operandYs } : v;
    });

  const fs = BASE_FONT_SIZE;
  const lh = fs * LINE_HEIGHT;

  // Create / destroy events drive head position and line end.
  const createdAt = new Map<ID, number>();
  const destroyedAt = new Map<ID, number>();
  for (const mv of messageViews) {
    const msg = doc.modelElements[mv.elementId];
    if (msg?.kind !== 'message' || !mv.targetViewId) continue;
    if (msg.sort === 'create' && !createdAt.has(mv.targetViewId)) createdAt.set(mv.targetViewId, mv.receiveY);
    if (msg.sort === 'destroy' && !destroyedAt.has(mv.targetViewId))
      destroyedAt.set(mv.targetViewId, mv.receiveY);
  }

  let contentBottom = 0;
  for (const lv of lifelineViews) contentBottom = Math.max(contentBottom, lv.y + lv.headHeight + 160);
  for (const mv of messageViews) contentBottom = Math.max(contentBottom, mv.sendY + 40, mv.receiveY + 40);
  for (const av of activationViews) contentBottom = Math.max(contentBottom, av.endY + 30);
  for (const fv of fragmentViews) contentBottom = Math.max(contentBottom, fv.y + fv.height + 30);

  // ---- Lifelines
  const lifelines = new Map<ID, LifelineRender>();
  for (const view of lifelineViews) {
    const element = doc.modelElements[view.elementId];
    if (element?.kind !== 'lifeline') continue;
    const s = resolveStyle(theme, view.style);
    const x = overrides.lifelineX?.get(view.id) ?? view.x;
    const created = createdAt.get(view.id);
    const top = created !== undefined ? created - view.headHeight / 2 : view.y;
    const label = lifelineLabel(doc, element);
    const headWidth = Math.max(view.width, Math.ceil(measureText(label, s.fontSize) + 16));
    const headBox = { x: x - headWidth / 2, y: top, width: headWidth, height: view.headHeight };
    const primitives: Primitive[] = [];
    const destroyed = destroyedAt.get(view.id) ?? null;
    const lineBottom = destroyed ?? contentBottom;
    primitives.push({
      type: 'line',
      x1: x,
      y1: top + view.headHeight,
      x2: x,
      y2: lineBottom,
      stroke: s.stroke,
      strokeWidth: 1,
      dash: '6 4',
    });
    if (element.headStyle === 'actor') {
      const figH = view.headHeight - lh - 4;
      const head = figH * 0.16;
      const neck = top + head * 2;
      const hip = top + figH * 0.62;
      primitives.push(
        { type: 'rect', ...headBox, fill: 'none', stroke: 'none', strokeWidth: 0 },
        {
          type: 'ellipse',
          cx: x,
          cy: top + head,
          rx: head,
          ry: head,
          fill: s.fill,
          stroke: s.stroke,
          strokeWidth: s.lineWidth,
        },
        { type: 'line', x1: x, y1: neck, x2: x, y2: hip, stroke: s.stroke, strokeWidth: s.lineWidth },
        {
          type: 'line',
          x1: x - figH * 0.28,
          y1: neck + figH * 0.12,
          x2: x + figH * 0.28,
          y2: neck + figH * 0.12,
          stroke: s.stroke,
          strokeWidth: s.lineWidth,
        },
        {
          type: 'line',
          x1: x,
          y1: hip,
          x2: x - figH * 0.24,
          y2: top + figH,
          stroke: s.stroke,
          strokeWidth: s.lineWidth,
        },
        {
          type: 'line',
          x1: x,
          y1: hip,
          x2: x + figH * 0.24,
          y2: top + figH,
          stroke: s.stroke,
          strokeWidth: s.lineWidth,
        },
        {
          type: 'text',
          x,
          y: top + figH + lh - 2,
          text: label,
          fontSize: s.fontSize,
          anchor: 'middle',
          fill: s.text,
          hit: { part: 'name' },
        },
      );
    } else {
      primitives.push(
        { type: 'rect', ...headBox, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
        {
          type: 'text',
          x,
          y: top + view.headHeight / 2 + s.fontSize * 0.35,
          text: label,
          fontSize: s.fontSize,
          anchor: 'middle',
          fill: s.text,
          hit: { part: 'name' },
        },
      );
    }
    if (destroyed !== null) {
      const d = 9;
      primitives.push(
        {
          type: 'line',
          x1: x - d,
          y1: destroyed - d,
          x2: x + d,
          y2: destroyed + d,
          stroke: s.stroke,
          strokeWidth: 1.8,
        },
        {
          type: 'line',
          x1: x + d,
          y1: destroyed - d,
          x2: x - d,
          y2: destroyed + d,
          stroke: s.stroke,
          strokeWidth: 1.8,
        },
      );
    }
    lifelines.set(view.id, {
      view,
      element,
      x,
      headBox,
      lineTop: top + view.headHeight,
      lineBottom,
      destroyedAt: destroyed,
      primitives,
      label,
    });
  }

  // ---- Activations (nesting depth by range containment on the same lifeline)
  const activations = new Map<ID, ActivationRender>();
  const byLifeline = new Map<ID, ActivationView[]>();
  for (const av of activationViews)
    byLifeline.set(av.lifelineViewId, [...(byLifeline.get(av.lifelineViewId) ?? []), av]);
  for (const [lifelineViewId, list] of byLifeline) {
    const lifeline = lifelines.get(lifelineViewId);
    if (!lifeline) continue;
    const sorted = list
      .slice()
      .sort((a, b) => a.startY - b.startY || b.endY - a.endY || a.id.localeCompare(b.id));
    for (const av of sorted) {
      const depth = sorted.filter(
        (o) =>
          o !== av &&
          o.startY <= av.startY &&
          o.endY >= av.endY &&
          (o.startY < av.startY || o.endY > av.endY || o.id < av.id),
      ).length;
      const s = resolveStyle(theme, av.style, theme.activationFill);
      const box = {
        x: lifeline.x - ACTIVATION_WIDTH / 2 + depth * (ACTIVATION_WIDTH / 2),
        y: av.startY,
        width: ACTIVATION_WIDTH,
        height: Math.max(4, av.endY - av.startY),
      };
      activations.set(av.id, {
        view: av,
        box,
        depth,
        primitives: [{ type: 'rect', ...box, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth }],
      });
    }
  }

  /** x where a message touches the lifeline at `y`, facing `towardX`. */
  const anchorX = (lifelineViewId: ID, y: number, towardX: number): number => {
    const lifeline = lifelines.get(lifelineViewId);
    if (!lifeline) return 0;
    let best: ActivationRender | null = null;
    for (const a of activations.values()) {
      if (a.view.lifelineViewId !== lifelineViewId) continue;
      if (y < a.box.y - 0.5 || y > a.box.y + a.box.height + 0.5) continue;
      if (!best || a.depth > best.depth) best = a;
    }
    if (!best) return lifeline.x;
    return towardX >= best.box.x + best.box.width / 2 ? best.box.x + best.box.width : best.box.x;
  };

  // ---- Messages
  const messages = new Map<ID, MessageRender>();
  const orderedMessageIds: ID[] = [];
  let number = 0;
  for (const mv of messageViews) {
    const element = doc.modelElements[mv.elementId];
    if (element?.kind !== 'message') continue;
    number += 1;
    orderedMessageIds.push(mv.id);
    const s = resolveStyle(theme, mv.style);
    const color = mv.style.stroke ?? theme.edge;
    const source = mv.sourceViewId ? lifelines.get(mv.sourceViewId) : undefined;
    const target = mv.targetViewId ? lifelines.get(mv.targetViewId) : undefined;
    const isSelf = !!source && source === target;
    let points: Point[];
    if (isSelf && source) {
      const x1 = anchorX(source.view.id, mv.sendY, source.x + 1000);
      const x2 = anchorX(source.view.id, mv.receiveY, source.x + 1000);
      const loopX = Math.max(x1, x2) + SELF_LOOP_WIDTH;
      points = [
        { x: x1, y: mv.sendY },
        { x: loopX, y: mv.sendY },
        { x: loopX, y: mv.receiveY },
        { x: x2, y: mv.receiveY },
      ];
    } else {
      const targetX = target?.x ?? (source ? source.x + FOUND_LOST_LENGTH : 0);
      const sourceX = source?.x ?? targetX - FOUND_LOST_LENGTH;
      const sx = source ? anchorX(source.view.id, mv.sendY, targetX) : sourceX;
      let tx = target ? anchorX(target.view.id, mv.receiveY, sourceX) : targetX;
      if (element.sort === 'create' && target)
        tx = sourceX < target.x ? target.headBox.x : target.headBox.x + target.headBox.width;
      points = [
        { x: sx, y: mv.sendY },
        { x: tx, y: mv.receiveY },
      ];
    }
    const dashed = element.sort === 'reply' || element.sort === 'create';
    const marker =
      element.sort === 'asynchronous' || element.sort === 'reply' || element.sort === 'create'
        ? 'openArrow'
        : 'filledArrow';
    const tip = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const primitives: Primitive[] = [
      {
        type: 'polyline',
        points: marker === 'filledArrow' ? trimEnd(points, 10) : points,
        stroke: color,
        strokeWidth: s.lineWidth,
        dash: dashed ? '6 4' : undefined,
        fill: 'none',
      },
      ...markerPrimitives(
        marker,
        tip,
        Math.atan2(tip.y - prev.y, tip.x - prev.x),
        color,
        theme.background,
        s.lineWidth,
      ),
    ];
    if (!source)
      primitives.push({
        type: 'ellipse',
        cx: points[0]!.x,
        cy: points[0]!.y,
        rx: 5,
        ry: 5,
        fill: color,
        stroke: color,
        strokeWidth: 1,
      });
    if (!target && !isSelf)
      primitives.push({
        type: 'ellipse',
        cx: tip.x + 5,
        cy: tip.y,
        rx: 5,
        ry: 5,
        fill: color,
        stroke: color,
        strokeWidth: 1,
      });

    let labelText = formatMessageLabel(element.name, element.arguments, element.sort);
    if (element.guard.trim()) labelText = `[${element.guard.trim()}] ${labelText}`;
    if (diagram.options.showMessageNumbers && element.sort !== 'reply')
      labelText = labelText ? `${number}: ${labelText}` : `${number}`;
    const textW = measureText(labelText, s.fontSize);
    const off = mv.labelOffset;
    let lx: number;
    let ly: number;
    let anchor: 'start' | 'middle';
    if (isSelf) {
      lx = points[1]!.x + 6 + off.x;
      ly = mv.sendY + (mv.receiveY - mv.sendY) / 2 + s.fontSize * 0.35 + off.y;
      anchor = 'start';
    } else {
      lx = (points[0]!.x + tip.x) / 2 + off.x;
      ly = Math.min(mv.sendY, mv.receiveY) - 6 + off.y;
      anchor = 'middle';
    }
    if (labelText) {
      primitives.push({
        type: 'text',
        x: lx,
        y: ly,
        text: labelText,
        fontSize: s.fontSize,
        anchor,
        fill: s.text,
        hit: { label: 'name' },
      });
    }
    const labelBounds = {
      x: anchor === 'start' ? lx - 2 : lx - textW / 2 - 2,
      y: ly - s.fontSize,
      width: textW + 4,
      height: s.fontSize * 1.35,
    };
    messages.set(mv.id, { view: mv, element, points, labelText, labelBounds, number, primitives });
  }

  // ---- Fragments
  const fragments = new Map<ID, FragmentRender>();
  for (const fv of fragmentViews) {
    const element = doc.modelElements[fv.elementId];
    if (element?.kind !== 'combinedFragment') continue;
    const s = resolveStyle(theme, fv.style, 'none');
    const box = { x: fv.x, y: fv.y, width: fv.width, height: fv.height };
    const tagText = element.operator;
    const tagW = measureText(tagText, s.fontSize, true) + 18;
    const tagH = 20;
    const tagBox = { x: fv.x, y: fv.y, width: tagW, height: tagH };
    const primitives: Primitive[] = [
      { type: 'rect', ...box, fill: fv.style.fill ?? 'none', stroke: s.stroke, strokeWidth: s.lineWidth },
    ];
    const overlay: Primitive[] = [
      {
        type: 'polygon',
        points: [
          { x: fv.x, y: fv.y },
          { x: fv.x + tagW, y: fv.y },
          { x: fv.x + tagW, y: fv.y + tagH - 6 },
          { x: fv.x + tagW - 6, y: fv.y + tagH },
          { x: fv.x, y: fv.y + tagH },
        ],
        fill: theme.fragmentLabelFill,
        stroke: s.stroke,
        strokeWidth: s.lineWidth,
      },
      {
        type: 'text',
        x: fv.x + 7,
        y: fv.y + tagH / 2 + s.fontSize * 0.35,
        text: tagText,
        fontSize: s.fontSize,
        bold: true,
        anchor: 'start',
        fill: s.text,
      },
    ];
    const tops = element.operands.map((o, i) =>
      i === 0 ? fv.y : (fv.operandYs[o.id] ?? fv.y + ((i + 1) * fv.height) / (element.operands.length + 1)),
    );
    const operands = element.operands.map((o, i) => {
      const top = tops[i]!;
      const bottom = tops[i + 1] ?? fv.y + fv.height;
      if (i > 0)
        primitives.push({
          type: 'line',
          x1: fv.x,
          y1: top,
          x2: fv.x + fv.width,
          y2: top,
          stroke: s.stroke,
          strokeWidth: s.lineWidth,
          dash: '6 4',
        });
      const gx = i === 0 ? fv.x + tagW + 8 : fv.x + 10;
      const gy = i === 0 ? fv.y + tagH / 2 + s.fontSize * 0.35 : top + s.fontSize + 4;
      const guardText = element.operator === 'ref' ? o.guard : o.guard.trim() ? `[${o.guard.trim()}]` : '';
      if (guardText) {
        const gw0 = measureText(guardText, s.fontSize);
        if (element.operator !== 'ref') {
          overlay.push({
            type: 'rect',
            x: gx - 2,
            y: gy - s.fontSize,
            width: gw0 + 4,
            height: s.fontSize * 1.3,
            fill: theme.background,
            stroke: 'none',
            strokeWidth: 0,
          });
        }
        if (element.operator === 'ref') {
          overlay.push({
            type: 'text',
            x: fv.x + fv.width / 2,
            y: fv.y + fv.height / 2 + s.fontSize * 0.35,
            text: guardText,
            fontSize: s.fontSize,
            anchor: 'middle',
            fill: s.text,
            hit: { member: o.id, collection: 'operands' },
          });
        } else {
          overlay.push({
            type: 'text',
            x: gx,
            y: gy,
            text: guardText,
            fontSize: s.fontSize,
            anchor: 'start',
            fill: s.text,
            hit: { member: o.id, collection: 'operands' },
          });
        }
      }
      const gw = Math.max(60, measureText(guardText || '[ ]', s.fontSize) + 8);
      return {
        id: o.id,
        top,
        bottom,
        guardBox: { x: gx - 2, y: gy - s.fontSize, width: gw, height: s.fontSize * 1.4 },
      };
    });
    fragments.set(fv.id, { view: fv, element, box, tagBox, operands, primitives, overlay });
  }

  // ---- Notes
  const notes = new Map<ID, NoteRender>();
  for (const view of views) {
    if (view.kind !== 'note') continue;
    const o = overrides.note?.get(view.id);
    const v = o
      ? { ...view, x: o.x, y: o.y, width: o.width ?? view.width, height: o.height ?? view.height }
      : view;
    notes.set(view.id, { view: v, layout: layoutNote(theme, v) });
  }

  const primitives: Primitive[] = [
    ...[...fragments.values()].flatMap((f) => f.primitives),
    ...[...lifelines.values()].flatMap((l) => l.primitives),
    ...[...activations.values()].sort((a, b) => a.depth - b.depth).flatMap((a) => a.primitives),
    ...[...fragments.values()].flatMap((f) => f.overlay),
    ...[...messages.values()].flatMap((m) => m.primitives),
    ...[...notes.values()].map((n): Primitive => ({
      type: 'group',
      dx: n.view.x,
      dy: n.view.y,
      children: n.layout.primitives,
    })),
  ];
  let bounds = primitivesBounds(primitives);
  for (const l of lifelines.values()) bounds = unionBounds(bounds, l.headBox);
  return {
    lifelines,
    activations,
    messages,
    fragments,
    notes,
    orderedMessageIds,
    bottom: contentBottom,
    primitives,
    bounds,
  };
}
