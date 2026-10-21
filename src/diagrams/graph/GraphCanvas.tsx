import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  ViewportPortal,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { ContextMenu } from 'radix-ui';
import {
  run,
  renameSelection,
  requestDeleteFromModel,
  removeSelectionFromDiagram,
  copySelectionToClipboard,
  pasteClipboard,
  duplicateSelection,
  reorderSelection,
  setRoutingForSelection,
  addMember,
} from '@/app/actions';
import { canvasApi } from '@/app/canvasApi';
import { primaryShortcut } from '@/app/commands';
import { useDiagramTheme } from '@/app/theme';
import { uuidGenerator } from '@/domain/ids';
import type { ID, Point } from '@/domain/schemas/common';
import type { EdgeLabelKey } from '@/domain/schemas/views';
import { findTool } from '@/diagrams/registry/catalog';
import { layoutGraphDiagram, type GraphNodeRender } from '@/diagrams/render/graphLayout';
import { InlineTextEditor } from '@/diagrams/shared/InlineTextEditor';
import { commitInlineEdit, initialEditText } from '@/diagrams/shared/inlineEdit';
import { closestSegment } from '@/diagrams/render/geometry';
import { menuContentClass, renderEntries, type MenuEntry } from '@/components/ui/menu';
import { useT } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore, type EditTarget } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { GraphCanvasContext, type Box, type GraphCanvasContextValue } from './canvasContext';
import {
  completeConnection,
  connectionProblem,
  DRAG_ELEMENT_MIME,
  DRAG_TOOL_MIME,
  dropExistingElement,
  placeTool,
} from './graphActions';
import { UmlEdge, type UmlEdgeType } from './UmlEdge';
import { UmlNode, type UmlNodeType } from './UmlNode';

const nodeTypes = { uml: UmlNode };
const edgeTypes = { uml: UmlEdge };
const EMPTY: ID[] = [];

export function GraphCanvas({ diagramId }: { diagramId: ID }) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner diagramId={diagramId} />
    </ReactFlowProvider>
  );
}

function GraphCanvasInner({ diagramId }: { diagramId: ID }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const diagram = doc.diagrams[diagramId]!;
  const theme = useDiagramTheme();
  const tool = useEditorStore((s) => s.tool);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const selection = useEditorStore((s) => s.selections[diagramId] ?? EMPTY);
  const editing = useEditorStore((s) => s.editing);
  const focusRequest = useEditorStore((s) => s.focusRequest);
  const savedViewport = useEditorStore((s) => s.viewports[diagramId]);
  const { showGrid, snapToGrid, gridSize, showMinimap } = useSettingsStore();
  const rf = useReactFlow<UmlNodeType, UmlEdgeType>();
  const wrapper = useRef<HTMLDivElement>(null);

  const [boxes, setBoxes] = useState<Map<ID, Box | { x: number; y: number }>>(new Map());
  const [waypointOverrides, setWaypointOverrides] = useState<Map<ID, Point[]>>(new Map());
  const [pendingSource, setPendingSource] = useState<ID | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [hoverNode, setHoverNode] = useState<ID | null>(null);
  const [reconnectPreview, setReconnectPreview] = useState<{ from: Point; to: Point } | null>(null);
  const dragOrigins = useRef<Map<ID, Point> | null>(null);
  const pointerDownNode = useRef<ID | null>(null);

  const interactive = tool.kind === 'select' && !spaceHeld;
  // Fit only when the diagram is opened without a remembered viewport (never while editing).
  const [initialFit] = useState(
    () => !savedViewport && !diagram.viewport && Object.keys(diagram.views).length > 0,
  );
  const connectTool = tool.kind === 'connect' ? findTool(tool.toolId) : undefined;

  const layout = useMemo(
    () => layoutGraphDiagram(doc, diagram, theme, { boxes, waypoints: waypointOverrides }),
    [doc, diagram, theme, boxes, waypointOverrides],
  );
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  // Clear connector state when the tool changes.
  useEffect(() => {
    setPendingSource(null);
    setHoverNode(null);
  }, [tool]);

  const connectState = useCallback(
    (viewId: ID): 'valid' | 'invalid' | 'source' | null => {
      if (tool.kind !== 'connect') return null;
      if (viewId === pendingSource) return 'source';
      if (viewId !== hoverNode || !pendingSource) return null;
      return connectionProblem(diagramId, tool.toolId, pendingSource, viewId) ? 'invalid' : 'valid';
    },
    [tool, pendingSource, hoverNode, diagramId],
  );

  // Reuse unchanged node/edge objects between renders so React Flow only re-renders what moved
  // (a drag frame touches one node and its edges, not the whole diagram).
  const nodeCache = useRef(new Map<ID, UmlNodeType>());
  const edgeCache = useRef(new Map<ID, UmlEdgeType>());
  const edgeTheme = useRef(theme);
  const nodes = useMemo<UmlNodeType[]>(() => {
    const previous = nodeCache.current;
    const next = new Map<ID, UmlNodeType>();
    const list = layout.nodes.map((n: GraphNodeRender) => {
      const state = connectState(n.view.id);
      const selected = selectedSet.has(n.view.id);
      const zIndex = n.isContainer ? n.depth : 1000 + n.depth;
      const old = previous.get(n.view.id);
      if (
        old &&
        old.data.render.layout === n.layout &&
        old.data.render.view === n.view &&
        old.data.render.element === n.element &&
        old.position.x === n.x &&
        old.position.y === n.y &&
        old.data.connectState === state &&
        old.selected === selected &&
        old.zIndex === zIndex &&
        old.draggable === interactive &&
        old.selectable === (tool.kind === 'select')
      ) {
        next.set(old.id, old);
        return old;
      }
      const created: UmlNodeType = {
        id: n.view.id,
        type: 'uml',
        position: { x: n.x, y: n.y },
        width: n.layout.width,
        height: n.layout.height,
        data: { render: n, connectState: state },
        selected,
        zIndex,
        draggable: interactive,
        selectable: tool.kind === 'select',
        connectable: false,
      };
      next.set(created.id, created);
      return created;
    });
    nodeCache.current = next;
    return list;
  }, [layout, selectedSet, connectState, interactive, tool.kind]);
  const edges = useMemo<UmlEdgeType[]>(() => {
    const previous = edgeCache.current;
    const next = new Map<ID, UmlEdgeType>();
    const samePoints = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
      a.length === b.length && a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y);
    const sameLabels = (
      a: { text: string; x: number; y: number }[],
      b: { text: string; x: number; y: number }[],
    ) =>
      a.length === b.length && a.every((l, i) => l.text === b[i]!.text && l.x === b[i]!.x && l.y === b[i]!.y);
    const list = layout.edges.map((e) => {
      const selected = selectedSet.has(e.view.id);
      const old = previous.get(e.view.id);
      const oldRender = old?.data?.render;
      if (
        old &&
        oldRender &&
        oldRender.view === e.view &&
        oldRender.relationship === e.relationship &&
        old.selected === selected &&
        old.selectable === (tool.kind === 'select') &&
        old.source === e.sourceViewId &&
        old.target === e.targetViewId &&
        edgeTheme.current === theme &&
        samePoints(oldRender.layout.points, e.layout.points) &&
        sameLabels(oldRender.layout.labels, e.layout.labels)
      ) {
        next.set(old.id, old);
        return old;
      }
      const created: UmlEdgeType = {
        id: e.view.id,
        source: e.sourceViewId,
        target: e.targetViewId,
        type: 'uml',
        data: { render: e },
        selected,
        // Edges (and their labels) draw above nodes, as in the SVG export.
        zIndex: 3000,
        selectable: tool.kind === 'select',
      };
      next.set(created.id, created);
      return created;
    });
    edgeCache.current = next;
    edgeTheme.current = theme;
    return list;
  }, [layout, selectedSet, tool.kind, theme]);

  // ---- Imperative viewport API for menus/shortcuts
  useEffect(() => {
    canvasApi.current = {
      zoomIn: () => void rf.zoomIn({ duration: 120 }),
      zoomOut: () => void rf.zoomOut({ duration: 120 }),
      resetZoom: () => void rf.zoomTo(1, { duration: 120 }),
      fit: () => void rf.fitView({ padding: 0.15, duration: 200, maxZoom: 1.5 }),
      getZoom: () => rf.getZoom(),
    };
    return () => {
      canvasApi.current = null;
    };
  }, [rf]);

  // ---- Focus requests (problems panel, search)
  useEffect(() => {
    if (!focusRequest || focusRequest.diagramId !== diagramId) return;
    const targets = focusRequest.viewIds
      .map((id) => layout.nodeById.get(id))
      .filter((n): n is GraphNodeRender => !!n);
    const edgeTargets = layout.edges.filter((e) => focusRequest.viewIds.includes(e.view.id));
    const pts = [
      ...targets.flatMap((n) => [
        { x: n.x, y: n.y },
        { x: n.x + n.layout.width, y: n.y + n.layout.height },
      ]),
      ...edgeTargets.flatMap((e) => e.layout.points),
    ];
    if (!pts.length) return;
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    void rf.setCenter(cx, cy, { zoom: Math.max(rf.getZoom(), 0.8), duration: 250 });
    // Only react to new requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  // ---- Selection & dragging
  const setSelection = useCallback(
    (ids: ID[]) => useEditorStore.getState().setSelection(diagramId, ids),
    [diagramId],
  );

  const descendantsOf = useCallback(
    (ids: ID[]): ID[] => {
      const result = new Set<ID>(ids);
      let changed = true;
      while (changed) {
        changed = false;
        for (const v of Object.values(diagram.views)) {
          if (
            (v.kind === 'node' || v.kind === 'note') &&
            v.containerViewId &&
            result.has(v.containerViewId) &&
            !result.has(v.id)
          ) {
            result.add(v.id);
            changed = true;
          }
        }
      }
      return [...result];
    },
    [diagram],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<UmlNodeType>[]) => {
      const selectChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: 'select' }> => c.type === 'select',
      );
      if (selectChanges.length && tool.kind === 'select') {
        const set = new Set(useEditorStore.getState().selections[diagramId] ?? EMPTY);
        for (const c of selectChanges) {
          if (c.selected) set.add(c.id);
          else set.delete(c.id);
        }
        setSelection([...set]);
      }
      const move = changes.find(
        (c): c is Extract<NodeChange, { type: 'position' }> =>
          c.type === 'position' && !!c.position && !!c.dragging,
      );
      const origins = dragOrigins.current;
      if (move?.position && origins) {
        const origin = origins.get(move.id);
        if (!origin) return;
        const dx = move.position.x - origin.x;
        const dy = move.position.y - origin.y;
        const next = new Map<ID, { x: number; y: number }>();
        for (const [id, o] of origins) next.set(id, { x: o.x + dx, y: o.y + dy });
        setBoxes(next);
      }
    },
    [tool.kind, diagramId, setSelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<UmlEdgeType>[]) => {
      const selectChanges = changes.filter(
        (c): c is Extract<EdgeChange, { type: 'select' }> => c.type === 'select',
      );
      if (!selectChanges.length || tool.kind !== 'select') return;
      const set = new Set(useEditorStore.getState().selections[diagramId] ?? EMPTY);
      for (const c of selectChanges) {
        if (c.selected) set.add(c.id);
        else set.delete(c.id);
      }
      setSelection([...set]);
    },
    [tool.kind, diagramId, setSelection],
  );

  const onNodeDragStart = useCallback(
    (_: unknown, _node: UmlNodeType, dragged: UmlNodeType[]) => {
      const ids = descendantsOf(dragged.map((n) => n.id));
      const origins = new Map<ID, Point>();
      for (const id of ids) {
        const n = layout.nodeById.get(id);
        if (n) origins.set(id, { x: n.x, y: n.y });
      }
      dragOrigins.current = origins;
    },
    [descendantsOf, layout],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: UmlNodeType, dragged: UmlNodeType[]) => {
      const origins = dragOrigins.current;
      dragOrigins.current = null;
      const origin = origins?.get(node.id);
      setBoxes(new Map());
      if (!origin) return;
      const dx = Math.round(node.position.x - origin.x);
      const dy = Math.round(node.position.y - origin.y);
      if (dx === 0 && dy === 0) return;
      run(
        { type: 'view/move', diagramId, viewIds: dragged.map((n) => n.id), dx, dy },
        { label: t('history.move') },
      );
    },
    [diagramId, t],
  );

  // ---- Canvas context callbacks
  const context = useMemo<GraphCanvasContextValue>(
    () => ({
      diagramId,
      theme,
      interactive,
      singleSelection: selection.length === 1,
      setTransientBox: (viewId, box) =>
        setBoxes((prev) => {
          const next = new Map(prev);
          if (box) next.set(viewId, box);
          else next.delete(viewId);
          return next;
        }),
      commitBox: (viewId, box) => {
        setBoxes(new Map());
        run(
          {
            type: 'view/update',
            diagramId,
            viewId,
            patch: {
              x: Math.round(box.x),
              y: Math.round(box.y),
              width: Math.round(box.width),
              height: Math.round(box.height),
            },
            recomputeContainment: true,
          },
          { label: t('history.resize') },
        );
      },
      setTransientWaypoints: (edgeId, points) =>
        setWaypointOverrides((prev) => {
          if (!points && !prev.has(edgeId)) return prev;
          const next = new Map(prev);
          if (points) next.set(edgeId, points);
          else next.delete(edgeId);
          return next;
        }),
      commitWaypoints: (edgeId, points) => {
        setWaypointOverrides(new Map());
        run(
          { type: 'view/update', diagramId, viewId: edgeId, patch: { waypoints: points } },
          { label: t('history.route') },
        );
      },
      commitLabelOffset: (edgeId, key: EdgeLabelKey, offset) => {
        const view = useDocumentStore.getState().doc?.diagrams[diagramId]?.views[edgeId];
        if (view?.kind !== 'edge') return;
        run(
          {
            type: 'view/update',
            diagramId,
            viewId: edgeId,
            patch: { labelOffsets: { ...view.labelOffsets, [key]: offset } },
          },
          { label: t('history.move') },
        );
      },
      reconnect: (edgeId, end, nodeViewId) => {
        const current = useDocumentStore.getState().doc;
        const view = current?.diagrams[diagramId]?.views[edgeId];
        const node = current?.diagrams[diagramId]?.views[nodeViewId];
        if (view?.kind !== 'edge' || node?.kind !== 'node') return;
        if ((end === 'source' ? view.sourceViewId : view.targetViewId) === nodeViewId) return;
        run(
          {
            type: 'element/reconnect',
            relationshipId: view.elementId,
            end,
            newElementId: node.elementId,
            edgeUpdates: [{ diagramId, edgeViewId: edgeId, nodeViewId }],
          },
          { label: t('history.route') },
        );
      },
      startEdit: (viewId, target) => useEditorStore.getState().setEditing({ diagramId, viewId, target }),
      addMember: (elementId, collection) => void addMember(collection, elementId),
      screenToFlow: (p) => rf.screenToFlowPosition(p),
      setReconnectPreview,
    }),
    [diagramId, theme, interactive, selection.length, rf, t],
  );

  // ---- Tools
  const flowPoint = (e: { clientX: number; clientY: number }) =>
    rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

  const onPaneClick = (e: ReactMouseEvent) => {
    if (tool.kind === 'place') {
      const def = findTool(tool.toolId);
      if (def) placeTool(diagramId, def, flowPoint(e));
    } else if (tool.kind === 'connect') {
      setPendingSource(null);
    }
  };

  const onNodeClick = (e: ReactMouseEvent, node: UmlNodeType) => {
    if (tool.kind === 'place') {
      const def = findTool(tool.toolId);
      if (def) placeTool(diagramId, def, flowPoint(e));
      return;
    }
    if (tool.kind !== 'connect') return;
    if (!pendingSource) {
      setPendingSource(node.id);
      return;
    }
    if (completeConnection(diagramId, tool.toolId, pendingSource, node.id)) setPendingSource(null);
  };

  const onPointerDownCapture = (e: ReactPointerEvent) => {
    wrapper.current?.focus({ preventScroll: true });
    if (tool.kind !== 'connect') return;
    const nodeEl = (e.target as Element).closest('.react-flow__node');
    pointerDownNode.current = nodeEl?.getAttribute('data-id') ?? null;
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    // Drag-to-connect: press on the source, release on the target.
    if (tool.kind !== 'connect' || !pointerDownNode.current) return;
    const nodeEl = (e.target as Element).closest('.react-flow__node');
    const targetId = nodeEl?.getAttribute('data-id');
    const sourceId = pointerDownNode.current;
    pointerDownNode.current = null;
    if (targetId && targetId !== sourceId && !pendingSource) {
      completeConnection(diagramId, tool.toolId, sourceId, targetId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (tool.kind === 'connect' && pendingSource) setPointer(flowPoint(e));
  };

  // ---- Double click: rename / edit member / edit label / add bend point
  const onNodeDoubleClick = (e: ReactMouseEvent, node: UmlNodeType) => {
    if (tool.kind !== 'select') return;
    const target = e.target as Element;
    const member = target.closest('[data-member]');
    if (member) {
      const collection = member.getAttribute('data-collection') as Extract<
        EditTarget,
        { type: 'member' }
      >['collection'];
      context.startEdit(node.id, {
        type: 'member',
        collection,
        memberId: member.getAttribute('data-member')!,
      });
      return;
    }
    if (node.data.render.layout.nameBox) context.startEdit(node.id, { type: 'name' });
  };

  const onEdgeDoubleClick = (e: ReactMouseEvent, edge: UmlEdgeType) => {
    if (tool.kind !== 'select' || !edge.data) return;
    const label = (e.target as Element).getAttribute('data-label') as EdgeLabelKey | null;
    if (label) {
      context.startEdit(edge.id, { type: 'label', key: label });
      return;
    }
    const render = edge.data.render;
    if (render.view.kind === 'edge' && render.view.routing === 'orthogonal') {
      context.startEdit(edge.id, { type: 'label', key: 'name' });
      return;
    }
    const p = flowPoint(e);
    const chain = [
      render.layout.points[0]!,
      ...render.view.waypoints,
      render.layout.points[render.layout.points.length - 1]!,
    ];
    const index = closestSegment(chain, p);
    const next = render.view.waypoints.slice();
    next.splice(index, 0, { x: Math.round(p.x), y: Math.round(p.y) });
    context.commitWaypoints(edge.id, next);
  };

  // ---- Drag & drop
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_ELEMENT_MIME) || e.dataTransfer.types.includes(DRAG_TOOL_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent) => {
    const elementId = e.dataTransfer.getData(DRAG_ELEMENT_MIME);
    const toolId = e.dataTransfer.getData(DRAG_TOOL_MIME);
    if (!elementId && !toolId) return;
    e.preventDefault();
    const p = flowPoint(e);
    if (elementId) dropExistingElement(diagramId, elementId, p);
    else {
      const def = findTool(toolId);
      if (def) placeTool(diagramId, def, p);
    }
  };

  // ---- Keyboard nudging
  const onKeyDown = (e: KeyboardEvent) => {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = arrows[e.key];
    if (!dir || editing || !selection.length) return;
    const boxIds = selection.filter((id) => {
      const v = diagram.views[id];
      return v?.kind === 'node' || v?.kind === 'note';
    });
    if (!boxIds.length) return;
    e.preventDefault();
    const step = e.shiftKey ? gridSize : 1;
    run(
      { type: 'view/move', diagramId, viewIds: boxIds, dx: dir[0] * step, dy: dir[1] * step },
      { label: t('history.move'), mergeKey: `nudge:${diagramId}:${boxIds.join(',')}` },
    );
  };

  const onMoveEnd = (_: unknown, viewport: Viewport) => {
    useEditorStore.getState().setViewport(diagramId, {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      zoom: Math.round(viewport.zoom * 1000) / 1000,
    });
  };

  // ---- Context menu
  const onContextMenuCapture = (e: ReactMouseEvent) => {
    const el = e.target as Element;
    const id =
      el.closest('.react-flow__node')?.getAttribute('data-id') ??
      el.closest('[data-edge-id]')?.getAttribute('data-edge-id') ??
      null;
    if (id && !selectedSet.has(id)) setSelection([id]);
    if (!id) setSelection([]);
  };
  const menuEntries = useCanvasMenuEntries(diagramId);

  // ---- Inline editor overlay
  const editor = useMemo(() => {
    if (!editing || editing.diagramId !== diagramId) return null;
    const view = diagram.views[editing.viewId];
    if (!view) return null;
    const node = layout.nodeById.get(editing.viewId);
    const edge = layout.edges.find((x) => x.view.id === editing.viewId);
    let box: { x: number; y: number; width: number; height: number } | null = null;
    let multiline = false;
    if (node) {
      if (editing.target.type === 'member') {
        const memberId = editing.target.memberId;
        const row = node.layout.rows.find((r) => r.memberId === memberId);
        if (row)
          box = {
            x: node.x + row.box.x + 2,
            y: node.y + row.box.y,
            width: Math.max(160, row.box.width - 4),
            height: row.box.height + 2,
          };
      } else if (node.layout.nameBox) {
        const nb = node.layout.nameBox;
        multiline = view.kind === 'note';
        box = {
          x: node.x + nb.x,
          y: node.y + nb.y - 1,
          width: Math.max(120, nb.width),
          height: multiline ? Math.max(48, nb.height) : nb.height + 4,
        };
      }
    } else if (edge && editing.target.type === 'label') {
      const key = editing.target.key;
      const label = edge.layout.labels.find((l) => l.key === key);
      const mid = edge.layout.points[Math.floor(edge.layout.points.length / 2)] ?? { x: 0, y: 0 };
      const b = label?.bounds ?? { x: mid.x - 60, y: mid.y - 20, width: 120, height: 18 };
      box = {
        x: b.x - 4,
        y: b.y - 2,
        width: Math.max(140, b.width + 16),
        height: Math.max(20, b.height + 4),
      };
    }
    if (!box) return null;
    return { box, multiline, initial: initialEditText(doc, diagram, editing.viewId, editing.target) };
  }, [editing, diagramId, diagram, layout, doc]);

  const commitEdit = (text: string): boolean => {
    const current = useEditorStore.getState().editing;
    const latestDoc = useDocumentStore.getState().doc;
    if (!current || !latestDoc) return true;
    const result = commitInlineEdit(
      latestDoc,
      latestDoc.diagrams[diagramId]!,
      current.viewId,
      current.target,
      text,
      uuidGenerator,
    );
    if (!result.ok) {
      toast.error(
        result.error === 'invalidMultiplicity'
          ? t('inspector.invalidMultiplicity')
          : t('canvas.invalidMemberText', { text }),
      );
      return false;
    }
    useEditorStore.getState().setEditing(null);
    if (result.commands.length) run(result.commands, { label: t('history.rename') });
    wrapper.current?.focus({ preventScroll: true });
    return true;
  };

  const sourceNode = pendingSource ? layout.nodeById.get(pendingSource) : undefined;
  const isEmpty = layout.nodes.length === 0;

  return (
    <GraphCanvasContext.Provider value={context}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            ref={wrapper}
            className="uml-canvas relative h-full w-full outline-none"
            data-canvas="graph"
            data-tool={spaceHeld ? 'hand' : tool.kind}
            data-testid="graph-canvas"
            tabIndex={0}
            onPointerDownCapture={onPointerDownCapture}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={onKeyDown}
            onContextMenuCapture={onContextMenuCapture}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <ReactFlow<UmlNodeType, UmlEdgeType>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={onPaneClick}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeDoubleClick={onEdgeDoubleClick}
              onNodeMouseEnter={(_, n) => setHoverNode(n.id)}
              onNodeMouseLeave={() => setHoverNode(null)}
              onMoveEnd={onMoveEnd}
              defaultViewport={savedViewport ?? diagram.viewport ?? { x: 40, y: 40, zoom: 1 }}
              fitView={initialFit}
              fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
              minZoom={0.1}
              maxZoom={4}
              snapToGrid={snapToGrid}
              snapGrid={[gridSize, gridSize]}
              nodesDraggable={interactive}
              nodesConnectable={false}
              elementsSelectable={tool.kind === 'select'}
              selectionOnDrag={interactive}
              selectionMode={SelectionMode.Partial}
              selectionKeyCode={null}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              panOnDrag={tool.kind === 'hand' || spaceHeld ? true : [1]}
              deleteKeyCode={null}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              elevateEdgesOnSelect={false}
              disableKeyboardA11y={false}
              nodeDragThreshold={2}
            >
              {showGrid && (
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={gridSize * 2}
                  size={1.4}
                  color="var(--canvas-grid)"
                />
              )}
              {showMinimap && (
                <MiniMap
                  pannable
                  zoomable
                  ariaLabel={t('canvas.minimap')}
                  nodeColor="var(--surface-4)"
                  maskColor="rgb(0 0 0 / 0.25)"
                />
              )}
              <ViewportPortal>
                <svg
                  className="pointer-events-none absolute top-0 left-0 overflow-visible"
                  width={1}
                  height={1}
                >
                  {sourceNode && pointer && (
                    <line
                      x1={sourceNode.x + sourceNode.layout.width / 2}
                      y1={sourceNode.y + sourceNode.layout.height / 2}
                      x2={pointer.x}
                      y2={pointer.y}
                      stroke="var(--selection)"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                    />
                  )}
                  {reconnectPreview && (
                    <line
                      x1={reconnectPreview.from.x}
                      y1={reconnectPreview.from.y}
                      x2={reconnectPreview.to.x}
                      y2={reconnectPreview.to.y}
                      stroke="var(--selection)"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                    />
                  )}
                </svg>
                {editor && (
                  <InlineTextEditor
                    key={`${editing!.viewId}:${JSON.stringify(editing!.target)}`}
                    style={{
                      left: editor.box.x,
                      top: editor.box.y,
                      width: editor.box.width,
                      height: editor.box.height,
                    }}
                    initial={editor.initial}
                    multiline={editor.multiline}
                    fontSize={13}
                    ariaLabel={t('cmd.rename')}
                    onCommit={commitEdit}
                    onCancel={() => {
                      useEditorStore.getState().setEditing(null);
                      wrapper.current?.focus({ preventScroll: true });
                    }}
                  />
                )}
              </ViewportPortal>
            </ReactFlow>
            {isEmpty && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="max-w-sm rounded-lg border border-dashed border-border-strong bg-surface-1/70 px-5 py-4 text-center text-[12.5px] text-muted">
                  {t('canvas.emptyHint')}
                </div>
              </div>
            )}
            {tool.kind === 'connect' && connectTool && (
              <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-[12px] text-muted shadow-panel">
                {pendingSource ? t('canvas.connectFrom') : t('toolbox.connectHint')}
              </div>
            )}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContentClass}>
            {renderEntries(menuEntries(), 'context')}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </GraphCanvasContext.Provider>
  );
}

/** Context menu entries computed lazily from the current selection. */
function useCanvasMenuEntries(diagramId: ID): () => MenuEntry[] {
  const t = useT();
  return useCallback(() => {
    const doc = useDocumentStore.getState().doc;
    const editor = useEditorStore.getState();
    const diagram = doc?.diagrams[diagramId];
    if (!doc || !diagram) return [];
    const selection = editor.selections[diagramId] ?? [];
    const views = selection.map((id) => diagram.views[id]).filter((v) => !!v);
    const sc = (id: string) => primaryShortcut(id);
    if (!views.length) {
      return [
        {
          label: t('cmd.paste'),
          shortcut: sc('edit.paste'),
          disabled: !editor.clipboard,
          onSelect: pasteClipboard,
        },
        {
          label: t('cmd.selectAll'),
          shortcut: sc('edit.selectAll'),
          onSelect: () => editor.setSelection(diagramId, Object.keys(diagram.views)),
        },
        { type: 'separator' },
        { label: t('cmd.fitDiagram'), shortcut: sc('view.fit'), onSelect: () => canvasApi.current?.fit() },
        { label: t('cmd.exportImage'), onSelect: () => editor.openDialog({ type: 'export', diagramId }) },
        { label: t('cmd.diagramProperties'), onSelect: () => editor.selectInExplorer(diagramId) },
      ];
    }
    const single = views.length === 1 ? views[0]! : undefined;
    const element = single && 'elementId' in single ? doc.modelElements[single.elementId] : undefined;
    const entries: MenuEntry[] = [];
    if (single && single.kind !== 'noteLink')
      entries.push({ label: t('cmd.rename'), shortcut: 'F2', onSelect: renameSelection });
    if (
      element &&
      (element.kind === 'class' ||
        element.kind === 'interface' ||
        element.kind === 'dataType' ||
        element.kind === 'signal' ||
        element.kind === 'enumeration')
    ) {
      if (element.kind === 'enumeration')
        entries.push({ label: t('cmd.addLiteral'), onSelect: () => void addMember('literals', element.id) });
      entries.push({
        label: t('cmd.addAttribute'),
        onSelect: () => void addMember('attributes', element.id),
      });
      entries.push({
        label: t('cmd.addOperation'),
        onSelect: () => void addMember('operations', element.id),
      });
    }
    if (single?.kind === 'node' && element && (element.kind === 'actor' || element.kind === 'interface')) {
      entries.push({
        label: t('inspector.alternateNotation'),
        checked: single.variant === 'alternate',
        onSelect: () =>
          run(
            {
              type: 'view/update',
              diagramId,
              viewId: single.id,
              patch: { variant: single.variant === 'alternate' ? 'default' : 'alternate' },
            },
            { label: t('history.style') },
          ),
      });
    }
    if (entries.length) entries.push({ type: 'separator' });
    entries.push(
      {
        label: t('cmd.cut'),
        shortcut: sc('edit.cut'),
        onSelect: () => copySelectionToClipboard() && requestDeleteFromModel(),
      },
      { label: t('cmd.copy'), shortcut: sc('edit.copy'), onSelect: () => void copySelectionToClipboard() },
      {
        label: t('cmd.paste'),
        shortcut: sc('edit.paste'),
        disabled: !editor.clipboard,
        onSelect: pasteClipboard,
      },
      { label: t('cmd.duplicate'), shortcut: sc('edit.duplicate'), onSelect: duplicateSelection },
      { type: 'separator' },
    );
    if (views.some((v) => v.kind === 'edge')) {
      entries.push(
        { label: t('cmd.routingStraight'), onSelect: () => setRoutingForSelection('straight') },
        { label: t('cmd.routingOrthogonal'), onSelect: () => setRoutingForSelection('orthogonal') },
      );
      if (single?.kind === 'edge') {
        entries.push(
          {
            label: t('inspector.clearWaypoints'),
            disabled: !single.waypoints.length,
            onSelect: () =>
              run(
                { type: 'view/update', diagramId, viewId: single.id, patch: { waypoints: [] } },
                { label: t('history.route') },
              ),
          },
          {
            label: t('inspector.resetLabels'),
            disabled: !Object.keys(single.labelOffsets).length,
            onSelect: () =>
              run(
                { type: 'view/update', diagramId, viewId: single.id, patch: { labelOffsets: {} } },
                { label: t('history.move') },
              ),
          },
        );
      }
      entries.push({ type: 'separator' });
    }
    entries.push(
      { label: t('cmd.bringToFront'), onSelect: () => reorderSelection('front') },
      { label: t('cmd.sendToBack'), onSelect: () => reorderSelection('back') },
      { type: 'separator' },
    );
    if (element)
      entries.push({ label: t('cmd.selectInExplorer'), onSelect: () => editor.selectInExplorer(element.id) });
    entries.push(
      {
        label: t('cmd.delete'),
        shortcut: sc('edit.delete'),
        onSelect: removeSelectionFromDiagram,
        testId: 'ctx-remove',
      },
      {
        label: t('cmd.deleteFromModel'),
        shortcut: sc('edit.deleteFromModel'),
        danger: true,
        disabled: !views.some((v) => 'elementId' in v),
        onSelect: () => requestDeleteFromModel(),
        testId: 'ctx-delete-model',
      },
    );
    return entries;
  }, [diagramId, t]);
}
