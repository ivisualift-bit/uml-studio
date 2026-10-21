import type { ID, Point } from '@/domain/schemas/common';
import { hasFeatures, type ElementOf, type ModelElement } from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import type { Compartment, NodeView, NoteView } from '@/domain/schemas/views';
import { formatAttribute, formatOperation } from '@/domain/notation/members';
import type { ShapeOutline } from './geometry';
import type { Bounds, Primitive } from './primitives';
import { LINE_HEIGHT, measureText, wrapText } from './textMetrics';
import { resolveStyle, type DiagramTheme, type ResolvedStyle } from './theme';

export type MemberCollectionKey = 'attributes' | 'operations' | 'literals' | 'slots' | 'extensionPoints' | 'tagDefinitions';

export interface MemberRow {
  collection: MemberCollectionKey;
  memberId: ID;
  box: Bounds;
}

export interface NodeLayout {
  /** Rendered size: max(stored size, intrinsic minimum). */
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** Outline used to dock edges, relative to the node origin. */
  outline: ShapeOutline;
  outlineBox: Bounds;
  primitives: Primitive[];
  /** Where the inline name editor goes (node-relative); null when the node has no editable name. */
  nameBox: Bounds | null;
  rows: MemberRow[];
  /** Compartment boxes (node-relative) for "add member" affordances. */
  compartments: Partial<Record<MemberCollectionKey, Bounds>>;
  /** Region inside which visual children live (containers). */
  bodyBox: Bounds | null;
}

export interface NodeRenderContext {
  doc: ProjectDocument;
  diagram: UMLDiagram;
  theme: DiagramTheme;
  /** The view visually contains other views (composite state, package with content…). */
  hasChildren: boolean;
}

const PAD = 8;
const KEYWORD_SCALE = 0.85;

const rowHeight = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT * 10) / 10;

function text(
  x: number,
  y: number,
  value: string,
  s: ResolvedStyle,
  extra: Partial<Extract<Primitive, { type: 'text' }>> = {},
): Extract<Primitive, { type: 'text' }> {
  return { type: 'text', x, y, text: value, fontSize: s.fontSize, anchor: 'middle', fill: s.text, ...extra };
}

const baseline = (top: number, lineHeight: number, fontSize: number) => top + (lineHeight + fontSize * 0.7) / 2;

// -------------------------------------------------------------------------------------------------
// Classifier boxes (class, interface, enumeration, component, stereotype, instance…)
// -------------------------------------------------------------------------------------------------

interface BoxRow {
  id: ID;
  text: string;
  italic?: boolean;
  underline?: boolean;
}

interface BoxCompartment {
  key: MemberCollectionKey;
  rows: BoxRow[];
}

interface ClassifierBoxInput {
  view: NodeView;
  theme: DiagramTheme;
  keywords: string[];
  name: string;
  nameItalic?: boolean;
  nameUnderline?: boolean;
  compartments: BoxCompartment[];
  icon?: 'component' | 'artifact';
  dashed?: boolean;
  rx?: number;
  /** Name drawn left-aligned (members always are). */
  hasChildren?: boolean;
}

function classifierBox(input: ClassifierBoxInput): NodeLayout {
  const s = resolveStyle(input.theme, input.view.style);
  const fs = s.fontSize;
  const kwSize = Math.round(fs * KEYWORD_SCALE);
  const lh = rowHeight(fs);
  const kwLh = rowHeight(kwSize);
  const iconSpace = input.icon ? 22 : 0;
  const keywordText = input.keywords.length ? `«${input.keywords.join(', ')}»` : '';

  const widths = [measureText(input.name || ' ', fs, true) + iconSpace * 2];
  if (keywordText) widths.push(measureText(keywordText, kwSize) + iconSpace * 2);
  for (const c of input.compartments) for (const r of c.rows) widths.push(measureText(r.text, fs));
  const minWidth = Math.max(80, Math.ceil(Math.max(...widths) + PAD * 2));

  const headerHeight = PAD / 2 + (keywordText ? kwLh : 0) + lh + PAD / 2;
  const compartmentHeights = input.compartments.map((c) => Math.max(c.rows.length * lh, 6) + PAD / 2 + 2);
  const minHeight = Math.ceil(headerHeight + compartmentHeights.reduce((a, b) => a + b, 0));
  const width = Math.max(input.view.width, minWidth);
  const height = Math.max(input.view.height, minHeight);
  const extra = height - minHeight;

  const primitives: Primitive[] = [
    {
      type: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: input.rx ?? 0,
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.lineWidth,
      dash: input.dashed ? '6 4' : undefined,
    },
  ];
  let y = PAD / 2;
  if (keywordText) {
    primitives.push(text(width / 2, baseline(y, kwLh, kwSize), keywordText, s, { fontSize: kwSize }));
    y += kwLh;
  }
  const nameBaseline = baseline(y, lh, fs);
  primitives.push(
    text(width / 2, nameBaseline, input.name, s, { bold: true, italic: input.nameItalic, underline: input.nameUnderline, hit: { part: 'name' } }),
  );
  const nameBox = { x: PAD / 2, y, width: width - PAD, height: lh };
  y += lh + PAD / 2;
  if (input.compartments.length === 0) y = height;

  const rows: MemberRow[] = [];
  const compartments: Partial<Record<MemberCollectionKey, Bounds>> = {};
  input.compartments.forEach((c, index) => {
    const isLast = index === input.compartments.length - 1;
    const h = compartmentHeights[index]! + (isLast ? extra : 0);
    primitives.push({ type: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: s.stroke, strokeWidth: s.lineWidth });
    compartments[c.key] = { x: 0, y, width, height: h };
    let rowTop = y + PAD / 4 + 1;
    for (const r of c.rows) {
      primitives.push(
        text(PAD, baseline(rowTop, lh, fs), r.text, s, {
          anchor: 'start',
          italic: r.italic,
          underline: r.underline,
          hit: { member: r.id, collection: c.key },
        }),
      );
      rows.push({ collection: c.key, memberId: r.id, box: { x: 0, y: rowTop, width, height: lh } });
      rowTop += lh;
    }
    y += h;
  });

  if (input.icon === 'component') primitives.push(...componentIcon(width - 22, 6, s));
  if (input.icon === 'artifact') primitives.push(...artifactIcon(width - 20, 6, s));

  return {
    width,
    height,
    minWidth,
    minHeight,
    outline: 'rect',
    outlineBox: { x: 0, y: 0, width, height },
    primitives,
    nameBox,
    rows,
    compartments,
    bodyBox: input.hasChildren ? { x: 0, y: headerHeight, width, height: height - headerHeight } : null,
  };
}

function componentIcon(x: number, y: number, s: ResolvedStyle): Primitive[] {
  return [
    { type: 'rect', x: x + 3, y, width: 13, height: 15, fill: s.fill, stroke: s.stroke, strokeWidth: 1 },
    { type: 'rect', x, y: y + 3, width: 7, height: 3.5, fill: s.fill, stroke: s.stroke, strokeWidth: 1 },
    { type: 'rect', x, y: y + 8.5, width: 7, height: 3.5, fill: s.fill, stroke: s.stroke, strokeWidth: 1 },
  ];
}

function artifactIcon(x: number, y: number, s: ResolvedStyle): Primitive[] {
  return [
    {
      type: 'polygon',
      points: [
        { x, y },
        { x: x + 9, y },
        { x: x + 13, y: y + 4 },
        { x: x + 13, y: y + 16 },
        { x, y: y + 16 },
      ],
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: 1,
    },
    { type: 'polyline', points: [{ x: x + 9, y }, { x: x + 9, y: y + 4 }, { x: x + 13, y: y + 4 }], stroke: s.stroke, strokeWidth: 1 },
  ];
}

function keywordsFor(doc: ProjectDocument, el: ModelElement, intrinsic?: string): string[] {
  const list: string[] = [];
  if (intrinsic) list.push(intrinsic);
  for (const part of el.stereotype.split(',')) if (part.trim()) list.push(part.trim());
  for (const applied of el.appliedStereotypes) {
    const st = doc.modelElements[applied.stereotypeId];
    if (st?.name) list.push(st.name);
  }
  return list;
}

function visible(view: NodeView, key: Compartment): boolean {
  return !view.hiddenCompartments.includes(key);
}

function featureCompartments(
  ctx: NodeRenderContext,
  view: NodeView,
  el: ElementOf<'class' | 'interface' | 'enumeration' | 'dataType' | 'primitiveType' | 'signal' | 'component'>,
  options: { attributes: 'always' | 'nonEmpty'; operations: 'always' | 'nonEmpty' },
): BoxCompartment[] {
  const o = ctx.diagram.options;
  const fmt = { showVisibility: o.showVisibility, showTypes: o.showAttributeTypes };
  const result: BoxCompartment[] = [];
  if (el.kind === 'enumeration' && visible(view, 'literals')) {
    result.push({ key: 'literals', rows: el.literals.map((l) => ({ id: l.id, text: l.name })) });
  }
  if (visible(view, 'attributes') && (options.attributes === 'always' || el.attributes.length)) {
    result.push({
      key: 'attributes',
      rows: el.attributes.map((a) => ({ id: a.id, text: formatAttribute(a, fmt), underline: a.isStatic })),
    });
  }
  if (visible(view, 'operations') && (options.operations === 'always' || el.operations.length)) {
    result.push({
      key: 'operations',
      rows: el.operations.map((op) => ({
        id: op.id,
        text: formatOperation(op, { ...fmt, showSignature: o.showOperationSignatures }),
        italic: op.isAbstract,
        underline: op.isStatic,
      })),
    });
  }
  return result;
}

// -------------------------------------------------------------------------------------------------
// Simple shapes
// -------------------------------------------------------------------------------------------------

function base(view: NodeView, minWidth: number, minHeight: number, outline: ShapeOutline): Omit<NodeLayout, 'primitives' | 'nameBox'> {
  const width = Math.max(view.width, minWidth);
  const height = Math.max(view.height, minHeight);
  return {
    width,
    height,
    minWidth,
    minHeight,
    outline,
    outlineBox: { x: 0, y: 0, width, height },
    rows: [],
    compartments: {},
    bodyBox: null,
  };
}

/** Centered multi-line label inside a box. */
function centeredLabel(
  label: string,
  box: Bounds,
  s: ResolvedStyle,
  extra: Partial<Extract<Primitive, { type: 'text' }>> = {},
): { primitives: Primitive[]; height: number } {
  const lh = rowHeight(s.fontSize);
  const lines = wrapText(label, Math.max(20, box.width - PAD * 2), s.fontSize, extra.bold);
  const total = lines.length * lh;
  const top = box.y + (box.height - total) / 2;
  return {
    primitives: lines.map((line, i) =>
      text(box.x + box.width / 2, baseline(top + i * lh, lh, s.fontSize), line, s, { hit: { part: 'name' }, ...extra }),
    ),
    height: total,
  };
}

function wrappedMin(label: string, s: ResolvedStyle, maxWidth: number, bold = false): { width: number; height: number } {
  const lines = wrapText(label || ' ', maxWidth, s.fontSize, bold);
  const width = Math.max(...lines.map((l) => measureText(l, s.fontSize, bold)));
  return { width: Math.ceil(width), height: Math.ceil(lines.length * rowHeight(s.fontSize)) };
}

function stickFigure(cx: number, top: number, h: number, s: ResolvedStyle): Primitive[] {
  const head = h * 0.16;
  const neck = top + head * 2;
  const hip = top + h * 0.62;
  const sw = s.lineWidth + 0.3;
  return [
    { type: 'ellipse', cx, cy: top + head, rx: head, ry: head, fill: s.fill, stroke: s.stroke, strokeWidth: sw },
    { type: 'line', x1: cx, y1: neck, x2: cx, y2: hip, stroke: s.stroke, strokeWidth: sw },
    { type: 'line', x1: cx - h * 0.28, y1: neck + h * 0.12, x2: cx + h * 0.28, y2: neck + h * 0.12, stroke: s.stroke, strokeWidth: sw },
    { type: 'line', x1: cx, y1: hip, x2: cx - h * 0.24, y2: top + h, stroke: s.stroke, strokeWidth: sw },
    { type: 'line', x1: cx, y1: hip, x2: cx + h * 0.24, y2: top + h, stroke: s.stroke, strokeWidth: sw },
  ];
}

function layoutActor(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'actor'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  if (view.variant === 'alternate') {
    return classifierBox({ view, theme: ctx.theme, keywords: keywordsFor(ctx.doc, el, 'actor'), name: el.name, nameItalic: el.isAbstract, compartments: [] });
  }
  const label = wrappedMin(el.name, s, 160);
  const minWidth = Math.max(40, label.width + 8);
  const minHeight = 60 + label.height + 4;
  const b = base(view, minWidth, minHeight, 'rect');
  const figureHeight = Math.max(40, b.height - label.height - 6);
  const figureWidth = figureHeight * 0.6;
  const cx = b.width / 2;
  const lines = wrapText(el.name, 160, s.fontSize);
  const lh = rowHeight(s.fontSize);
  const labelTop = figureHeight + 4;
  return {
    ...b,
    outlineBox: { x: cx - figureWidth / 2, y: 0, width: figureWidth, height: figureHeight },
    primitives: [
      // transparent hit rect so the whole node is grabbable
      { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: 'none', stroke: 'none', strokeWidth: 0 },
      ...stickFigure(cx, 1, figureHeight - 2, s),
      ...lines.map((line, i) => text(cx, baseline(labelTop + i * lh, lh, s.fontSize), line, s, { italic: el.isAbstract, hit: { part: 'name' } })),
    ],
    nameBox: { x: 0, y: labelTop, width: b.width, height: Math.max(lh, label.height) },
  };
}

function layoutUseCase(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'useCase'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const showPoints = el.extensionPoints.length > 0 && visible(view, 'extensionPoints');
  const label = wrappedMin(el.name, s, Math.max(100, view.width * 0.72));
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const pointsText = el.extensionPoints.map((p) => p.name);
  const pointsWidth = showPoints ? Math.max(measureText('extension points', kwSize, true), ...pointsText.map((t) => measureText(t, kwSize))) : 0;
  const minWidth = Math.ceil(Math.max(label.width, pointsWidth) / 0.72 + PAD);
  const pointsHeight = showPoints ? (pointsText.length + 1) * rowHeight(kwSize) + 6 : 0;
  const minHeight = Math.ceil((label.height + pointsHeight) / 0.72 + PAD);
  const b = base(view, Math.max(100, minWidth), Math.max(50, minHeight), 'ellipse');
  const primitives: Primitive[] = [
    { type: 'ellipse', cx: b.width / 2, cy: b.height / 2, rx: b.width / 2, ry: b.height / 2, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
  ];
  const keywords = keywordsFor(ctx.doc, el);
  const nameArea = { x: b.width * 0.14, y: 0, width: b.width * 0.72, height: showPoints ? b.height * 0.5 : b.height };
  if (keywords.length) {
    primitives.push(text(b.width / 2, nameArea.y + nameArea.height / 2 - label.height / 2 - 2, `«${keywords.join(', ')}»`, s, { fontSize: kwSize }));
  }
  primitives.push(...centeredLabel(el.name, nameArea, s, { italic: el.isAbstract }).primitives);
  const rows: MemberRow[] = [];
  if (showPoints) {
    const lineY = b.height * 0.5;
    const half = (b.width / 2) * Math.sqrt(1 - Math.pow((lineY - b.height / 2) / (b.height / 2), 2));
    primitives.push({ type: 'line', x1: b.width / 2 - half, y1: lineY, x2: b.width / 2 + half, y2: lineY, stroke: s.stroke, strokeWidth: s.lineWidth });
    const lh = rowHeight(kwSize);
    primitives.push(text(b.width / 2, baseline(lineY + 2, lh, kwSize), 'extension points', s, { fontSize: kwSize, bold: true }));
    el.extensionPoints.forEach((p, i) => {
      const top = lineY + 2 + (i + 1) * lh;
      primitives.push(text(b.width / 2, baseline(top, lh, kwSize), p.name, s, { fontSize: kwSize, hit: { member: p.id, collection: 'extensionPoints' } }));
      rows.push({ collection: 'extensionPoints', memberId: p.id, box: { x: b.width * 0.2, y: top, width: b.width * 0.6, height: lh } });
    });
  }
  return { ...b, primitives, nameBox: nameArea, rows };
}

function layoutFrameContainer(
  ctx: NodeRenderContext,
  view: NodeView,
  el: ModelElement,
  options: { minWidth: number; minHeight: number; headerAlign: 'center' | 'start'; keyword?: string },
): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style, ctx.theme.containerFill);
  const keywords = keywordsFor(ctx.doc, el, options.keyword);
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const lh = rowHeight(s.fontSize);
  const kwLh = keywords.length ? rowHeight(kwSize) : 0;
  const nameWidth = Math.max(measureText(el.name || ' ', s.fontSize, true), keywords.length ? measureText(`«${keywords.join(', ')}»`, kwSize) : 0);
  const b = base(view, Math.max(options.minWidth, nameWidth + PAD * 4), Math.max(options.minHeight, lh + kwLh + PAD * 2), 'rect');
  const x = options.headerAlign === 'center' ? b.width / 2 : PAD;
  const anchor = options.headerAlign === 'center' ? 'middle' : 'start';
  const primitives: Primitive[] = [
    { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
  ];
  let y = PAD / 2;
  if (keywords.length) {
    primitives.push(text(x, baseline(y, kwLh, kwSize), `«${keywords.join(', ')}»`, s, { fontSize: kwSize, anchor }));
    y += kwLh;
  }
  primitives.push(text(x, baseline(y, lh, s.fontSize), el.name, s, { bold: true, anchor, hit: { part: 'name' } }));
  return {
    ...b,
    primitives,
    nameBox: { x: PAD / 2, y, width: b.width - PAD, height: lh },
    bodyBox: { x: 0, y: y + lh, width: b.width, height: b.height - y - lh },
  };
}

function layoutPackage(ctx: NodeRenderContext, view: NodeView, el: ModelElement): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style, ctx.theme.containerFill);
  const keyword = el.kind === 'profile' ? 'profile' : el.kind === 'model' ? 'model' : undefined;
  const keywords = keywordsFor(ctx.doc, el, keyword);
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const lh = rowHeight(s.fontSize);
  const kwLh = rowHeight(kwSize);
  const nameWidth = measureText(el.name || ' ', s.fontSize, true);
  const kwText = keywords.length ? `«${keywords.join(', ')}»` : '';
  const kwWidth = kwText ? measureText(kwText, kwSize) : 0;
  const tabH = 20;
  const inTab = ctx.hasChildren;
  const tabW = Math.max(50, inTab ? Math.max(nameWidth, kwWidth) + PAD * 2 : 50);
  const minWidth = Math.ceil(Math.max(tabW + 20, nameWidth + PAD * 2, kwWidth + PAD * 2, 100));
  const minHeight = tabH + (inTab ? 40 : lh + (kwText ? kwLh : 0) + PAD * 2);
  const b = base(view, minWidth, minHeight, 'rect');
  const tabHeight = inTab && kwText ? tabH + kwLh - 4 : tabH;
  const primitives: Primitive[] = [
    { type: 'rect', x: 0, y: 0, width: tabW, height: tabHeight, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
    { type: 'rect', x: 0, y: tabHeight, width: b.width, height: b.height - tabHeight, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
  ];
  let nameBox: Bounds;
  if (inTab) {
    let y = 2;
    if (kwText) {
      primitives.push(text(PAD, baseline(y, kwLh - 2, kwSize), kwText, s, { fontSize: kwSize, anchor: 'start' }));
      y += kwLh - 4;
    }
    primitives.push(text(PAD, baseline(y, tabH - 2, s.fontSize), el.name, s, { bold: true, anchor: 'start', hit: { part: 'name' } }));
    nameBox = { x: 2, y, width: tabW - 4, height: tabH - 2 };
  } else {
    const body = { x: 0, y: tabHeight, width: b.width, height: b.height - tabHeight };
    const total = lh + (kwText ? kwLh : 0);
    let y = body.y + (body.height - total) / 2;
    if (kwText) {
      primitives.push(text(b.width / 2, baseline(y, kwLh, kwSize), kwText, s, { fontSize: kwSize }));
      y += kwLh;
    }
    primitives.push(text(b.width / 2, baseline(y, lh, s.fontSize), el.name, s, { bold: true, hit: { part: 'name' } }));
    nameBox = { x: PAD, y, width: b.width - PAD * 2, height: lh };
  }
  return { ...b, primitives, nameBox, bodyBox: { x: 0, y: tabHeight, width: b.width, height: b.height - tabHeight } };
}

function layoutAction(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'action'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const label = wrappedMin(el.name, s, Math.max(80, view.width - PAD * 3));
  const extraW = el.actionKind === 'sendSignal' || el.actionKind === 'acceptEvent' ? 20 : 0;
  if (el.actionKind === 'acceptTimeEvent') {
    const minW = Math.max(30, label.width + 4);
    const b = base(view, minW, 34 + label.height + 4, 'rect');
    const cx = b.width / 2;
    const glass: Primitive = {
      type: 'polygon',
      points: [
        { x: cx - 12, y: 2 },
        { x: cx + 12, y: 2 },
        { x: cx - 12, y: 32 },
        { x: cx + 12, y: 32 },
      ],
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.lineWidth,
    };
    return {
      ...b,
      outlineBox: { x: cx - 12, y: 2, width: 24, height: 30 },
      primitives: [
        { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: 'none', stroke: 'none', strokeWidth: 0 },
        glass,
        ...centeredLabel(el.name, { x: 0, y: 34, width: b.width, height: b.height - 34 }, s).primitives,
      ],
      nameBox: { x: 0, y: 34, width: b.width, height: b.height - 34 },
    };
  }
  const b = base(view, Math.max(90, label.width + PAD * 3 + extraW), Math.max(40, label.height + PAD * 2), 'rect');
  const { width: w, height: h } = b;
  let shape: Primitive;
  if (el.actionKind === 'sendSignal') {
    shape = {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: w - 18, y: 0 },
        { x: w, y: h / 2 },
        { x: w - 18, y: h },
        { x: 0, y: h },
      ],
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.lineWidth,
    };
  } else if (el.actionKind === 'acceptEvent') {
    shape = {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 18, y: h / 2 },
      ],
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.lineWidth,
    };
  } else {
    shape = { type: 'rect', x: 0, y: 0, width: w, height: h, rx: 12, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth };
  }
  const primitives: Primitive[] = [shape];
  if (el.actionKind === 'callBehavior') {
    // Rake symbol (call behavior action).
    const x = w - 16;
    const y = h - 16;
    primitives.push(
      { type: 'line', x1: x + 5, y1: y, x2: x + 5, y2: y + 10, stroke: s.stroke, strokeWidth: 1 },
      { type: 'polyline', points: [{ x, y: y + 10 }, { x, y: y + 5 }, { x: x + 10, y: y + 5 }, { x: x + 10, y: y + 10 }], stroke: s.stroke, strokeWidth: 1 },
    );
  }
  const labelBox = { x: el.actionKind === 'acceptEvent' ? 16 : 0, y: 0, width: w - extraW, height: h };
  primitives.push(...centeredLabel(el.name, labelBox, s).primitives);
  return { ...b, primitives, nameBox: { x: PAD, y: h / 2 - 10, width: w - PAD * 2, height: 20 } };
}

function solidCircle(cx: number, cy: number, r: number, theme: DiagramTheme, s: ResolvedStyle): Primitive {
  return { type: 'ellipse', cx, cy, rx: r, ry: r, fill: s.fill === theme.nodeFill ? theme.solidFill : s.fill, stroke: s.stroke, strokeWidth: s.lineWidth };
}

function bullseye(size: number, theme: DiagramTheme, s: ResolvedStyle): Primitive[] {
  const r = size / 2;
  return [
    { type: 'ellipse', cx: r, cy: r, rx: r - 1, ry: r - 1, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth + 0.3 },
    solidCircle(r, r, r * 0.6, theme, s),
  ];
}

function labelBelow(name: string, top: number, width: number, s: ResolvedStyle): Primitive[] {
  if (!name) return [];
  return [text(width / 2, top + s.fontSize, name, s, { hit: { part: 'name' } })];
}

function bar(w: number, h: number, theme: DiagramTheme, s: ResolvedStyle): Primitive {
  return { type: 'rect', x: 0, y: 0, width: w, height: h, rx: 1.5, fill: s.fill === theme.nodeFill ? theme.solidFill : s.fill, stroke: s.stroke, strokeWidth: 0.8 };
}

function diamond(w: number, h: number, s: ResolvedStyle): Primitive {
  return {
    type: 'polygon',
    points: [
      { x: w / 2, y: 0 },
      { x: w, y: h / 2 },
      { x: w / 2, y: h },
      { x: 0, y: h / 2 },
    ],
    fill: s.fill,
    stroke: s.stroke,
    strokeWidth: s.lineWidth,
  };
}

function layoutControlNode(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'controlNode'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  switch (el.nodeKind) {
    case 'initial': {
      const b = base(view, 16, 16, 'circle');
      const d = Math.min(b.width, b.height);
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: [solidCircle(d / 2, d / 2, d / 2 - 0.5, ctx.theme, s)], nameBox: null };
    }
    case 'activityFinal': {
      const b = base(view, 18, 18, 'circle');
      const d = Math.min(b.width, b.height);
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: bullseye(d, ctx.theme, s), nameBox: null };
    }
    case 'flowFinal': {
      const b = base(view, 18, 18, 'circle');
      const d = Math.min(b.width, b.height);
      const r = d / 2;
      const k = r * 0.7071;
      return {
        ...b,
        outlineBox: { x: 0, y: 0, width: d, height: d },
        primitives: [
          { type: 'ellipse', cx: r, cy: r, rx: r - 0.5, ry: r - 0.5, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
          { type: 'line', x1: r - k, y1: r - k, x2: r + k, y2: r + k, stroke: s.stroke, strokeWidth: s.lineWidth },
          { type: 'line', x1: r + k, y1: r - k, x2: r - k, y2: r + k, stroke: s.stroke, strokeWidth: s.lineWidth },
        ],
        nameBox: null,
      };
    }
    case 'decision':
    case 'merge': {
      const b = base(view, 24, 24, 'diamond');
      const d = Math.min(b.width, b.height);
      return {
        ...b,
        outlineBox: { x: 0, y: 0, width: b.width, height: d },
        primitives: [diamond(b.width, d, s), ...labelBelow(el.name, d + 2, b.width, s)],
        nameBox: { x: -40, y: d + 2, width: b.width + 80, height: 18 },
      };
    }
    case 'fork':
    case 'join':
    default: {
      const b = base(view, 4, 4, 'rect');
      return { ...b, primitives: [bar(b.width, b.height, ctx.theme, s)], nameBox: null };
    }
  }
}

function layoutPseudostate(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'pseudostate'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const circleBase = (min: number) => {
    const b = base(view, min, min, 'circle');
    const d = Math.min(b.width, b.height);
    return { b, d, r: d / 2 };
  };
  switch (el.pseudoKind) {
    case 'initial': {
      const { b, d, r } = circleBase(16);
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: [solidCircle(r, r, r - 0.5, ctx.theme, s)], nameBox: null };
    }
    case 'junction': {
      const { b, d, r } = circleBase(10);
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: [solidCircle(r, r, r - 0.5, ctx.theme, s)], nameBox: null };
    }
    case 'choice': {
      const b = base(view, 22, 22, 'diamond');
      return { ...b, primitives: [diamond(b.width, b.height, s), ...labelBelow(el.name, b.height + 2, b.width, s)], nameBox: { x: -40, y: b.height + 2, width: b.width + 80, height: 18 } };
    }
    case 'fork':
    case 'join': {
      const b = base(view, 4, 4, 'rect');
      return { ...b, primitives: [bar(b.width, b.height, ctx.theme, s)], nameBox: null };
    }
    case 'shallowHistory':
    case 'deepHistory': {
      const { b, d, r } = circleBase(22);
      return {
        ...b,
        outlineBox: { x: 0, y: 0, width: d, height: d },
        primitives: [
          { type: 'ellipse', cx: r, cy: r, rx: r - 0.5, ry: r - 0.5, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
          text(r, r + s.fontSize * 0.36, el.pseudoKind === 'deepHistory' ? 'H*' : 'H', s, { bold: true }),
        ],
        nameBox: null,
      };
    }
    case 'terminate': {
      const b = base(view, 16, 16, 'rect');
      return {
        ...b,
        primitives: [
          { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: 'none', stroke: 'none', strokeWidth: 0 },
          { type: 'line', x1: 0, y1: 0, x2: b.width, y2: b.height, stroke: s.stroke, strokeWidth: s.lineWidth + 0.5 },
          { type: 'line', x1: b.width, y1: 0, x2: 0, y2: b.height, stroke: s.stroke, strokeWidth: s.lineWidth + 0.5 },
        ],
        nameBox: null,
      };
    }
    case 'entryPoint':
    case 'exitPoint':
    default: {
      const { b, d, r } = circleBase(16);
      const k = r * 0.7071;
      const prims: Primitive[] = [{ type: 'ellipse', cx: r, cy: r, rx: r - 0.5, ry: r - 0.5, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth }];
      if (el.pseudoKind === 'exitPoint') {
        prims.push(
          { type: 'line', x1: r - k, y1: r - k, x2: r + k, y2: r + k, stroke: s.stroke, strokeWidth: s.lineWidth },
          { type: 'line', x1: r + k, y1: r - k, x2: r - k, y2: r + k, stroke: s.stroke, strokeWidth: s.lineWidth },
        );
      }
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: [...prims, ...labelBelow(el.name, d + 2, d, s)], nameBox: { x: -40, y: d + 2, width: d + 80, height: 18 } };
    }
  }
}

function layoutState(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'state'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const lh = rowHeight(s.fontSize);
  const internal: Array<{ text: string }> = [];
  if (visible(view, 'internalActivities')) {
    if (el.entry) internal.push({ text: `entry / ${el.entry}` });
    if (el.doActivity) internal.push({ text: `do / ${el.doActivity}` });
    if (el.exit) internal.push({ text: `exit / ${el.exit}` });
  }
  const keywords = keywordsFor(ctx.doc, el);
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const kwLh = keywords.length ? rowHeight(kwSize) : 0;
  const widths = [measureText(el.name || ' ', s.fontSize, true), ...internal.map((i) => measureText(i.text, s.fontSize))];
  const headerH = PAD / 2 + kwLh + lh + PAD / 2;
  const internalH = internal.length ? internal.length * lh + PAD : 0;
  const minHeight = Math.max(40, headerH + internalH + (ctx.hasChildren ? 40 : 0));
  const b = base(view, Math.max(90, Math.ceil(Math.max(...widths) + PAD * 3)), Math.ceil(minHeight), 'rect');
  const primitives: Primitive[] = [
    { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, rx: 10, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
  ];
  const composite = ctx.hasChildren || internal.length > 0;
  let y = composite ? PAD / 2 : (b.height - (kwLh + lh)) / 2;
  if (keywords.length) {
    primitives.push(text(b.width / 2, baseline(y, kwLh, kwSize), `«${keywords.join(', ')}»`, s, { fontSize: kwSize }));
    y += kwLh;
  }
  primitives.push(text(b.width / 2, baseline(y, lh, s.fontSize), el.name, s, { bold: true, hit: { part: 'name' } }));
  const nameBox = { x: PAD, y, width: b.width - PAD * 2, height: lh };
  y += lh + PAD / 2;
  if (composite) {
    primitives.push({ type: 'line', x1: 0, y1: y, x2: b.width, y2: y, stroke: s.stroke, strokeWidth: s.lineWidth });
    let rowTop = y + PAD / 2;
    for (const row of internal) {
      primitives.push(text(PAD, baseline(rowTop, lh, s.fontSize), row.text, s, { anchor: 'start' }));
      rowTop += lh;
    }
    if (ctx.hasChildren && internal.length) {
      y = rowTop + PAD / 2;
      primitives.push({ type: 'line', x1: 0, y1: y, x2: b.width, y2: y, stroke: s.stroke, strokeWidth: s.lineWidth, dash: '4 3' });
    }
  }
  return { ...b, primitives, nameBox, bodyBox: ctx.hasChildren ? { x: 0, y, width: b.width, height: b.height - y } : null };
}

function layoutNodeBox(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'node'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const depth = 12;
  const keyword = el.nodeKind === 'device' ? 'device' : el.nodeKind === 'executionEnvironment' ? 'executionEnvironment' : undefined;
  const keywords = keywordsFor(ctx.doc, el, keyword);
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const kwText = keywords.length ? `«${keywords.join(', ')}»` : '';
  const lh = rowHeight(s.fontSize);
  const kwLh = kwText ? rowHeight(kwSize) : 0;
  const textW = Math.max(measureText(el.name || ' ', s.fontSize, true), kwText ? measureText(kwText, kwSize) : 0);
  const b = base(view, Math.ceil(textW + PAD * 2 + depth), Math.ceil(lh + kwLh + PAD * 2 + depth + (ctx.hasChildren ? 30 : 0)), 'rect');
  const { width: w, height: h } = b;
  const front = { x: 0, y: depth, width: w - depth, height: h - depth };
  const primitives: Primitive[] = [
    {
      type: 'polygon',
      points: [
        { x: 0, y: depth },
        { x: depth, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h - depth },
        { x: w - depth, y: h },
        { x: 0, y: h },
      ],
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.lineWidth,
    },
    { type: 'rect', ...front, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
    { type: 'line', x1: w - depth, y1: depth, x2: w, y2: 0, stroke: s.stroke, strokeWidth: s.lineWidth },
  ];
  const align = ctx.hasChildren ? 'start' : 'middle';
  const tx = ctx.hasChildren ? PAD : front.width / 2;
  let y = ctx.hasChildren ? front.y + PAD / 2 : front.y + (front.height - lh - kwLh) / 2;
  if (kwText) {
    primitives.push(text(tx, baseline(y, kwLh, kwSize), kwText, s, { fontSize: kwSize, anchor: align }));
    y += kwLh;
  }
  primitives.push(text(tx, baseline(y, lh, s.fontSize), el.name, s, { bold: true, anchor: align, hit: { part: 'name' } }));
  return { ...b, outlineBox: front, primitives, nameBox: { x: PAD / 2, y, width: front.width - PAD, height: lh }, bodyBox: { x: 0, y: y + lh, width: front.width, height: h - y - lh } };
}

function layoutPort(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'port'>): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const b = base(view, 12, 12, 'rect');
  const label = el.typeName ? `${el.name} : ${el.typeName}` : el.name;
  return {
    ...b,
    primitives: [
      { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
      ...(label ? [text(b.width + 3, b.height + s.fontSize * 0.9, label, s, { anchor: 'start', fontSize: Math.round(s.fontSize * 0.9), hit: { part: 'name' } })] : []),
    ],
    nameBox: { x: b.width + 2, y: b.height, width: Math.max(80, measureText(label, s.fontSize) + 10), height: 18 },
  };
}

function typedLabel(name: string, typeName: string, multiplicity = ''): string {
  let label = name;
  if (typeName) label += `${name ? ' ' : ''}: ${typeName}`;
  if (multiplicity) label += ` [${multiplicity}]`;
  return label;
}

function layoutSimpleBox(
  ctx: NodeRenderContext,
  view: NodeView,
  el: ModelElement,
  label: string,
  options: { underline?: boolean; dashed?: boolean; keyword?: string; minWidth?: number; minHeight?: number; bold?: boolean } = {},
): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const keywords = keywordsFor(ctx.doc, el, options.keyword);
  const kwSize = Math.round(s.fontSize * KEYWORD_SCALE);
  const kwText = keywords.length ? `«${keywords.join(', ')}»` : '';
  const kwLh = kwText ? rowHeight(kwSize) : 0;
  const textMin = wrappedMin(label, s, 220, options.bold);
  const b = base(
    view,
    Math.max(options.minWidth ?? 70, Math.ceil(Math.max(textMin.width, kwText ? measureText(kwText, kwSize) : 0) + PAD * 2)),
    Math.max(options.minHeight ?? 30, Math.ceil(textMin.height + kwLh + PAD * 2)),
    'rect',
  );
  const primitives: Primitive[] = [
    { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth, dash: options.dashed ? '6 4' : undefined },
  ];
  const top = (b.height - textMin.height - kwLh) / 2;
  if (kwText) primitives.push(text(b.width / 2, baseline(top, kwLh, kwSize), kwText, s, { fontSize: kwSize }));
  primitives.push(
    ...centeredLabel(label, { x: 0, y: top + kwLh, width: b.width, height: textMin.height }, s, { underline: options.underline, bold: options.bold }).primitives,
  );
  return { ...b, primitives, nameBox: { x: PAD, y: top + kwLh, width: b.width - PAD * 2, height: Math.max(18, textMin.height) } };
}

function layoutInstance(ctx: NodeRenderContext, view: NodeView, el: ElementOf<'instanceSpecification'>): NodeLayout {
  const classifier = el.classifierId ? ctx.doc.modelElements[el.classifierId]?.name : el.classifierName;
  const title = classifier ? `${el.name} : ${classifier}` : el.name;
  const slots: BoxCompartment[] = visible(view, 'slots')
    ? [{ key: 'slots', rows: el.slots.map((slot) => ({ id: slot.id, text: `${slot.name} = ${slot.value}` })) }]
    : [];
  return classifierBox({ view, theme: ctx.theme, keywords: keywordsFor(ctx.doc, el), name: title, nameUnderline: true, compartments: el.slots.length ? slots : [] });
}

function layoutCollaboration(ctx: NodeRenderContext, view: NodeView, el: ModelElement): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style, ctx.theme.containerFill);
  const lh = rowHeight(s.fontSize);
  const b = base(view, Math.ceil(measureText(el.name || ' ', s.fontSize, true) * 1.6 + PAD * 2), 70, 'ellipse');
  return {
    ...b,
    primitives: [
      { type: 'ellipse', cx: b.width / 2, cy: b.height / 2, rx: b.width / 2, ry: b.height / 2, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth, dash: '6 4' },
      text(b.width / 2, ctx.hasChildren ? 22 : b.height / 2 + s.fontSize * 0.35, el.name, s, { bold: true, hit: { part: 'name' } }),
    ],
    nameBox: { x: b.width * 0.2, y: ctx.hasChildren ? 8 : b.height / 2 - lh / 2, width: b.width * 0.6, height: lh },
    bodyBox: { x: b.width * 0.15, y: 30, width: b.width * 0.7, height: b.height - 40 },
  };
}

function layoutInterfaceLollipop(ctx: NodeRenderContext, view: NodeView, el: ModelElement): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style);
  const label = wrappedMin(el.name, s, 160);
  const b = base(view, Math.max(24, label.width + 4), 24 + label.height + 2, 'circle');
  const cx = b.width / 2;
  return {
    ...b,
    outlineBox: { x: cx - 10, y: 0, width: 20, height: 20 },
    primitives: [
      { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: 'none', stroke: 'none', strokeWidth: 0 },
      { type: 'ellipse', cx, cy: 10, rx: 10, ry: 10, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
      // The label may be wider than the ball: centre it without the box padding.
      ...centeredLabel(el.name, { x: -PAD - 40, y: 22, width: b.width + 2 * PAD + 80, height: label.height }, s).primitives,
    ],
    nameBox: { x: -40, y: 22, width: b.width + 80, height: Math.max(18, label.height) },
  };
}

function layoutLane(ctx: NodeRenderContext, view: NodeView, el: ModelElement): NodeLayout {
  const s = resolveStyle(ctx.theme, view.style, ctx.theme.containerFill);
  const lh = rowHeight(s.fontSize);
  const header = Math.max(28, lh + PAD);
  const b = base(view, Math.ceil(Math.max(100, measureText(el.name || ' ', s.fontSize, true) + PAD * 2)), 120, 'rect');
  return {
    ...b,
    primitives: [
      { type: 'rect', x: 0, y: 0, width: b.width, height: b.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.lineWidth },
      { type: 'rect', x: 0, y: 0, width: b.width, height: header, fill: ctx.theme.laneHeaderFill, stroke: s.stroke, strokeWidth: s.lineWidth },
      text(b.width / 2, baseline((header - lh) / 2, lh, s.fontSize), el.name, s, { bold: true, hit: { part: 'name' } }),
    ],
    nameBox: { x: PAD, y: (header - lh) / 2, width: b.width - PAD * 2, height: lh },
    bodyBox: { x: 0, y: header, width: b.width, height: b.height - header },
  };
}

// -------------------------------------------------------------------------------------------------
// Entry points
// -------------------------------------------------------------------------------------------------

export function layoutNode(ctx: NodeRenderContext, view: NodeView, el: ModelElement): NodeLayout {
  const doc = ctx.doc;
  switch (el.kind) {
    case 'class':
      if (ctx.hasChildren && ctx.diagram.kind === 'compositeStructure') {
        // Structured classifier: name compartment + internal structure (parts, ports, connectors).
        return layoutFrameContainer(ctx, view, el, { minWidth: 200, minHeight: 140, headerAlign: 'center' });
      }
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el),
        name: el.name,
        nameItalic: el.isAbstract,
        compartments: featureCompartments(ctx, view, el, { attributes: 'always', operations: 'always' }),
        hasChildren: ctx.hasChildren,
      });
    case 'interface':
      if (view.variant === 'alternate') return layoutInterfaceLollipop(ctx, view, el);
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el, 'interface'),
        name: el.name,
        nameItalic: el.isAbstract,
        compartments: featureCompartments(ctx, view, el, { attributes: 'nonEmpty', operations: 'always' }),
      });
    case 'enumeration':
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el, 'enumeration'),
        name: el.name,
        compartments: featureCompartments(ctx, view, el, { attributes: 'nonEmpty', operations: 'nonEmpty' }),
      });
    case 'dataType':
    case 'primitiveType':
    case 'signal': {
      const keyword = el.kind === 'dataType' ? 'dataType' : el.kind === 'primitiveType' ? 'primitive' : 'signal';
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el, keyword),
        name: el.name,
        nameItalic: el.isAbstract,
        compartments: featureCompartments(ctx, view, el, { attributes: 'always', operations: 'nonEmpty' }),
      });
    }
    case 'component': {
      if (ctx.hasChildren) {
        const frame = layoutFrameContainer(ctx, view, el, { minWidth: 160, minHeight: 100, headerAlign: 'start', keyword: 'component' });
        const s = resolveStyle(ctx.theme, view.style, ctx.theme.containerFill);
        return { ...frame, primitives: [...frame.primitives, ...componentIcon(frame.width - 22, 6, s)] };
      }
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el, 'component'),
        name: el.name,
        compartments: hasFeatures(el) ? featureCompartments(ctx, view, el, { attributes: 'nonEmpty', operations: 'nonEmpty' }) : [],
        icon: 'component',
      });
    }
    case 'artifact':
      return classifierBox({ view, theme: ctx.theme, keywords: keywordsFor(doc, el, 'artifact'), name: el.name, compartments: [], icon: 'artifact' });
    case 'stereotype':
      return classifierBox({
        view,
        theme: ctx.theme,
        keywords: keywordsFor(doc, el, 'stereotype'),
        name: el.name,
        compartments: visible(view, 'tagDefinitions')
          ? [
              {
                key: 'tagDefinitions',
                rows: el.tagDefinitions.map((t) => ({ id: t.id, text: `${t.name}: ${t.type}${t.defaultValue ? ` = ${t.defaultValue}` : ''}` })),
              },
            ]
          : [],
      });
    case 'metaclass':
      return classifierBox({ view, theme: ctx.theme, keywords: keywordsFor(doc, el, 'metaclass'), name: el.name, compartments: [] });
    case 'informationItem':
      return classifierBox({ view, theme: ctx.theme, keywords: keywordsFor(doc, el, 'information'), name: el.name, compartments: [] });
    case 'instanceSpecification':
      return layoutInstance(ctx, view, el);
    case 'model':
    case 'package':
    case 'profile':
      return layoutPackage(ctx, view, el);
    case 'subject':
      return layoutFrameContainer(ctx, view, el, { minWidth: 160, minHeight: 120, headerAlign: 'center' });
    case 'actor':
      return layoutActor(ctx, view, el);
    case 'useCase':
      return layoutUseCase(ctx, view, el);
    case 'action':
      return layoutAction(ctx, view, el);
    case 'controlNode':
      return layoutControlNode(ctx, view, el);
    case 'objectNode':
      return layoutSimpleBox(ctx, view, el, typedLabel(el.name, el.typeName), { minWidth: 80 });
    case 'activityPartition':
      return layoutLane(ctx, view, el);
    case 'state':
      return layoutState(ctx, view, el);
    case 'pseudostate':
      return layoutPseudostate(ctx, view, el);
    case 'finalState': {
      const b = base(view, 18, 18, 'circle');
      const d = Math.min(b.width, b.height);
      const s = resolveStyle(ctx.theme, view.style);
      return { ...b, outlineBox: { x: 0, y: 0, width: d, height: d }, primitives: bullseye(d, ctx.theme, s), nameBox: null };
    }
    case 'node':
      return layoutNodeBox(ctx, view, el);
    case 'port':
      return layoutPort(ctx, view, el);
    case 'part':
      return layoutSimpleBox(ctx, view, el, typedLabel(el.name, el.typeName, el.multiplicity), { dashed: el.aggregation !== 'composite', minWidth: 80 });
    case 'collaboration':
      return layoutCollaboration(ctx, view, el);
    case 'lifeline': {
      const typeName = el.typeElementId ? (doc.modelElements[el.typeElementId]?.name ?? el.typeName) : el.typeName;
      return layoutSimpleBox(ctx, view, el, typedLabel(el.name, typeName), { minWidth: 80 });
    }
    default:
      return layoutSimpleBox(ctx, view, el, el.name || el.kind);
  }
}

export function layoutNote(theme: DiagramTheme, view: NoteView): NodeLayout {
  const s = resolveStyle(theme, view.style, theme.noteFill);
  const stroke = view.style.stroke ?? theme.noteStroke;
  const fold = 10;
  const lh = rowHeight(s.fontSize);
  const lines = wrapText(view.text, Math.max(40, view.width - PAD * 2 - fold / 2), s.fontSize);
  const textW = Math.max(40, ...lines.map((l) => measureText(l, s.fontSize)));
  const minWidth = Math.min(Math.max(60, Math.ceil(textW + PAD * 2 + fold / 2)), Math.max(60, view.width));
  const minHeight = Math.ceil(lines.length * lh + PAD * 2);
  const width = Math.max(view.width, minWidth);
  const height = Math.max(view.height, minHeight, 30);
  const primitives: Primitive[] = [
    {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: width - fold, y: 0 },
        { x: width, y: fold },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      fill: s.fill,
      stroke,
      strokeWidth: 1,
    },
    { type: 'polyline', points: [{ x: width - fold, y: 0 }, { x: width - fold, y: fold }, { x: width, y: fold }], stroke, strokeWidth: 1 },
    ...lines.map((line, i): Primitive => text(PAD, baseline(PAD + i * lh, lh, s.fontSize), line, s, { anchor: 'start', hit: { part: 'name' } })),
  ];
  return {
    width,
    height,
    minWidth,
    minHeight,
    outline: 'rect',
    outlineBox: { x: 0, y: 0, width, height },
    primitives,
    nameBox: { x: 4, y: 4, width: width - 8, height: height - 8 },
    rows: [],
    compartments: {},
    bodyBox: null,
  };
}

/** Absolute docking bounds of a laid-out node. */
export function dockingBounds(origin: Point, layout: NodeLayout): Bounds {
  return { x: origin.x + layout.outlineBox.x, y: origin.y + layout.outlineBox.y, width: layout.outlineBox.width, height: layout.outlineBox.height };
}
