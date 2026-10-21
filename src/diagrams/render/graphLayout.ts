import type { ID } from '@/domain/schemas/common';
import { isRelationship, type ModelElement, type Relationship } from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import type { EdgeView, NodeView, NoteLinkView, NoteView } from '@/domain/schemas/views';
import { CONTAINER_KINDS } from '@/domain/model/metadata';
import { conveyedLabel, layoutEdge, routeEdge, type EdgeLayout, type EndpointShape } from './edges';
import { layoutNode, layoutNote, type NodeLayout } from './nodeShapes';
import { primitivesBounds, unionBounds, type Bounds, type Primitive } from './primitives';
import type { DiagramTheme } from './theme';

export interface GraphNodeRender {
  view: NodeView | NoteView;
  element?: ModelElement;
  layout: NodeLayout;
  x: number;
  y: number;
  depth: number;
  isContainer: boolean;
  docking: EndpointShape;
}

export interface GraphEdgeRender {
  view: EdgeView | NoteLinkView;
  relationship?: Relationship;
  layout: EdgeLayout;
  sourceViewId: ID;
  targetViewId: ID;
}

export interface GraphDiagramLayout {
  nodes: GraphNodeRender[];
  nodeById: Map<ID, GraphNodeRender>;
  edges: GraphEdgeRender[];
  bounds: Bounds | null;
}

export interface LayoutOverrides {
  /** Transient positions/sizes during drag & resize (canvas only). */
  boxes?: ReadonlyMap<ID, { x: number; y: number; width?: number; height?: number }>;
  /** Transient waypoints during bend-point dragging. */
  waypoints?: ReadonlyMap<ID, Array<{ x: number; y: number }>>;
}

/** Memoised node layouts: keyed by element and view object identity (immutable snapshots). */
const nodeLayoutCache = new WeakMap<object, WeakMap<object, Map<string, NodeLayout>>>();

function cachedNodeLayout(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  theme: DiagramTheme,
  view: NodeView | NoteView,
  element: ModelElement | undefined,
  hasChildren: boolean,
  sizeOverride: { width?: number; height?: number } | undefined,
): NodeLayout {
  const effectiveView = sizeOverride?.width || sizeOverride?.height ? { ...view, width: sizeOverride.width ?? view.width, height: sizeOverride.height ?? view.height } : view;
  if (view.kind === 'note') return layoutNote(theme, effectiveView as NoteView);
  if (!element) throw new Error('node without element');
  // Applied stereotypes and classifier names can depend on other elements; include the diagram
  // options and the element record identity in the key so stale layouts are never reused.
  const key = `${theme.name}|${hasChildren}|${effectiveView.width}x${effectiveView.height}`;
  const byElement = nodeLayoutCache.get(element) ?? new WeakMap<object, Map<string, NodeLayout>>();
  nodeLayoutCache.set(element, byElement);
  const scope = byElement.get(view) ?? new Map<string, NodeLayout>();
  byElement.set(view, scope);
  const fullKey = `${key}|${optionsKey(diagram)}|${dependencyKey(doc, element)}`;
  const hit = scope.get(fullKey);
  if (hit) return hit;
  const layout = layoutNode({ doc, diagram, theme, hasChildren }, effectiveView as NodeView, element);
  if (scope.size > 8) scope.clear();
  scope.set(fullKey, layout);
  return layout;
}

function optionsKey(diagram: UMLDiagram): string {
  const o = diagram.options;
  return `${+o.showVisibility}${+o.showAttributeTypes}${+o.showOperationSignatures}`;
}

/** Names of other elements a node's text depends on (classifier of an instance, stereotypes…). */
function dependencyKey(doc: ProjectDocument, el: ModelElement): string {
  const parts: string[] = [];
  for (const a of el.appliedStereotypes) parts.push(doc.modelElements[a.stereotypeId]?.name ?? '');
  if (el.kind === 'instanceSpecification' && el.classifierId) parts.push(doc.modelElements[el.classifierId]?.name ?? '');
  if (el.kind === 'lifeline' && el.typeElementId) parts.push(doc.modelElements[el.typeElementId]?.name ?? '');
  return parts.join('\u0001');
}

export function layoutGraphDiagram(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  theme: DiagramTheme,
  overrides: LayoutOverrides = {},
): GraphDiagramLayout {
  const views = Object.values(diagram.views);
  const containerIds = new Set<ID>();
  for (const v of views) if ((v.kind === 'node' || v.kind === 'note') && v.containerViewId) containerIds.add(v.containerViewId);

  const depthOf = (view: NodeView | NoteView): number => {
    let depth = 0;
    let current: ID | null = view.containerViewId;
    const seen = new Set<ID>();
    while (current && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      const parent = diagram.views[current];
      current = parent && (parent.kind === 'node' || parent.kind === 'note') ? parent.containerViewId : null;
    }
    return depth;
  };

  const nodes: GraphNodeRender[] = [];
  views.forEach((view) => {
    if (view.kind !== 'node' && view.kind !== 'note') return;
    const element = view.kind === 'node' ? doc.modelElements[view.elementId] : undefined;
    if (view.kind === 'node' && !element) return;
    const box = overrides.boxes?.get(view.id);
    const layout = cachedNodeLayout(doc, diagram, theme, view, element, containerIds.has(view.id), box);
    const x = box?.x ?? view.x;
    const y = box?.y ?? view.y;
    nodes.push({
      view,
      element,
      layout,
      x,
      y,
      depth: depthOf(view),
      isContainer: !!element && CONTAINER_KINDS.has(element.kind) && (containerIds.has(view.id) || element.kind === 'activityPartition' || element.kind === 'subject'),
      docking: {
        bounds: { x: x + layout.outlineBox.x, y: y + layout.outlineBox.y, width: layout.outlineBox.width, height: layout.outlineBox.height },
        outline: layout.outline,
      },
    });
  });
  const order = new Map(views.map((v, i) => [v.id, i]));
  nodes.sort((a, b) => a.depth - b.depth || +b.isContainer - +a.isContainer || order.get(a.view.id)! - order.get(b.view.id)!);
  const nodeById = new Map(nodes.map((n) => [n.view.id, n]));

  // Parallel straight edges between the same pair are fanned out.
  const pairCount = new Map<string, ID[]>();
  for (const v of views) {
    if (v.kind !== 'edge' || v.waypoints.length || v.routing !== 'straight' || v.sourceViewId === v.targetViewId) continue;
    const key = [v.sourceViewId, v.targetViewId].sort().join('|');
    pairCount.set(key, [...(pairCount.get(key) ?? []), v.id]);
  }
  const parallelOffset = (v: EdgeView): number => {
    const key = [v.sourceViewId, v.targetViewId].sort().join('|');
    const group = pairCount.get(key);
    if (!group || group.length < 2) return 0;
    const i = group.indexOf(v.id);
    const offset = (i - (group.length - 1) / 2) * 18;
    return v.sourceViewId < v.targetViewId ? offset : -offset;
  };

  const edges: GraphEdgeRender[] = [];
  for (const view of views) {
    if (view.kind !== 'edge' && view.kind !== 'noteLink') continue;
    const s = nodeById.get(view.sourceViewId);
    const t = nodeById.get(view.targetViewId);
    if (!s || !t) continue;
    const waypoints = overrides.waypoints?.get(view.id) ?? view.waypoints;
    if (view.kind === 'noteLink') {
      const points = routeEdge({ source: s.docking, target: t.docking, waypoints, routing: 'straight', isSelf: false, parallelOffset: 0 });
      const color = view.style.stroke ?? theme.noteStroke;
      edges.push({
        view,
        sourceViewId: s.view.id,
        targetViewId: t.view.id,
        layout: {
          points,
          primitives: [{ type: 'polyline', points, stroke: color, strokeWidth: 1, dash: '4 3', fill: 'none' }],
          labels: [],
          path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '),
        },
      });
      continue;
    }
    const rel = doc.modelElements[view.elementId];
    if (!rel || !isRelationship(rel)) continue;
    const points = routeEdge({
      source: s.docking,
      target: t.docking,
      waypoints,
      routing: view.routing,
      isSelf: view.sourceViewId === view.targetViewId,
      parallelOffset: parallelOffset(view),
    });
    const extraName = conveyedLabel(doc, rel);
    const ballTarget = rel.kind === 'realization' && t.view.kind === 'node' && t.view.variant === 'alternate' && t.element?.kind === 'interface';
    edges.push({
      view,
      relationship: rel,
      sourceViewId: s.view.id,
      targetViewId: t.view.id,
      layout: layoutEdge({ doc, relationship: rel, view, points, theme, extraName, providedInterfaceBall: ballTarget }),
    });
  }

  let bounds: Bounds | null = null;
  for (const n of nodes) {
    bounds = unionBounds(bounds, primitivesBounds(n.layout.primitives, n.x, n.y));
    bounds = unionBounds(bounds, { x: n.x, y: n.y, width: n.layout.width, height: n.layout.height });
  }
  for (const e of edges) bounds = unionBounds(bounds, primitivesBounds(e.layout.primitives));
  return { nodes, nodeById, edges, bounds };
}

/** Flatten a graph layout into export primitives: containers, other nodes, then edges on top (as on the canvas). */
export function graphPrimitives(layout: GraphDiagramLayout): Primitive[] {
  const group = (n: GraphNodeRender): Primitive => ({ type: 'group', dx: n.x, dy: n.y, children: n.layout.primitives });
  return [...layout.nodes.map(group), ...layout.edges.flatMap((e) => e.layout.primitives)];
}
