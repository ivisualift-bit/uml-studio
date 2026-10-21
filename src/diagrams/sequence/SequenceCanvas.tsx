import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import { ContextMenu } from 'radix-ui';
import {
  copySelectionToClipboard,
  duplicateSelection,
  pasteClipboard,
  removeSelectionFromDiagram,
  renameSelection,
  requestDeleteFromModel,
  run,
} from '@/app/actions';
import { canvasApi } from '@/app/canvasApi';
import { primaryShortcut } from '@/app/commands';
import { useDiagramTheme } from '@/app/theme';
import {
  createActivationCommands,
  createFragmentCommands,
  createLifelineCommands,
  createMessageCommands,
  createNoteCommands,
} from '@/domain/commands/creators';
import { uuidGenerator } from '@/domain/ids';
import type { ID, Point } from '@/domain/schemas/common';
import type { MessageSort } from '@/domain/schemas/members';
import type { Viewport } from '@/domain/schemas/project';
import { findTool, type ToolDef } from '@/diagrams/registry/catalog';
import { layoutSequence, type SequenceOverrides } from '@/diagrams/render/sequenceLayout';
import { InlineTextEditor } from '@/diagrams/shared/InlineTextEditor';
import { commitInlineEdit, initialEditText } from '@/diagrams/shared/inlineEdit';
import { PrimitiveSvg } from '@/diagrams/shared/PrimitiveSvg';
import { DRAG_ELEMENT_MIME } from '@/diagrams/graph/graphActions';
import { menuContentClass, renderEntries, type MenuEntry } from '@/components/ui/menu';
import { useT } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore, type EditTarget } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';

const EMPTY: ID[] = [];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

type Drag =
  | { kind: 'pan'; start: Point; origin: Viewport }
  | { kind: 'lifeline'; viewId: ID; start: Point; originX: number }
  | { kind: 'message'; viewId: ID; start: Point; origin: { sendY: number; receiveY: number } }
  | { kind: 'messageLabel'; viewId: ID; start: Point; base: Point }
  | {
      kind: 'activation';
      viewId: ID;
      mode: 'move' | 'top' | 'bottom';
      start: Point;
      origin: { startY: number; endY: number };
    }
  | {
      kind: 'fragment';
      viewId: ID;
      mode: 'move' | 'se' | 'e' | 's';
      start: Point;
      origin: { x: number; y: number; width: number; height: number };
      originYs: Record<ID, number>;
    }
  | {
      kind: 'operand';
      viewId: ID;
      operandId: ID;
      start: Point;
      originY: number;
      originYs: Record<ID, number>;
    }
  | {
      kind: 'note';
      viewId: ID;
      mode: 'move' | 'resize';
      start: Point;
      origin: { x: number; y: number; width: number; height: number };
    }
  | { kind: 'marquee'; start: Point; current: Point }
  | { kind: 'newMessage'; toolId: string; sourceViewId: ID; y: number; start: Point; current: Point }
  | { kind: 'newFragment'; tool: Extract<ToolDef, { type: 'fragment' }>; start: Point; current: Point }
  | { kind: 'newActivation'; lifelineViewId: ID; start: Point; current: Point }
  /** Click-to-place tools act on release (like a click) so the new inline editor keeps focus. */
  | { kind: 'placeClick'; start: Point; hit: Hit | null };

interface Hit {
  kind: string;
  viewId?: ID;
  part?: string;
  operandId?: ID;
}

function hitAt(target: EventTarget | null): Hit | null {
  const el = (target as Element | null)?.closest?.('[data-hit-kind]');
  if (!el) return null;
  return {
    kind: el.getAttribute('data-hit-kind')!,
    viewId: el.getAttribute('data-view') ?? undefined,
    part: el.getAttribute('data-part') ?? undefined,
    operandId: el.getAttribute('data-operand') ?? undefined,
  };
}

export function SequenceCanvas({ diagramId }: { diagramId: ID }) {
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
  const { showGrid, snapToGrid, gridSize } = useSettingsStore();
  const [viewport, setViewportState] = useState<Viewport>(
    () => savedViewport ?? diagram.viewport ?? { x: 40, y: 10, zoom: 1 },
  );
  const [overrides, setOverrides] = useState<SequenceOverrides>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pendingSource, setPendingSource] = useState<{ viewId: ID; y: number } | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const layout = useMemo(
    () => layoutSequence(doc, diagram, theme, overrides),
    [doc, diagram, theme, overrides],
  );
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const activeTool = tool.kind === 'place' || tool.kind === 'connect' ? findTool(tool.toolId) : undefined;
  const panning = tool.kind === 'hand' || spaceHeld;

  const setViewport = useCallback(
    (next: Viewport) => {
      const v = {
        x: Math.round(next.x),
        y: Math.round(next.y),
        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next.zoom * 1000) / 1000)),
      };
      setViewportState(v);
      useEditorStore.getState().setViewport(diagramId, v);
    },
    [diagramId],
  );

  const toDiagram = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      return {
        x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
        y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  const snapX = (x: number) => (snapToGrid ? Math.round(x / gridSize) * gridSize : Math.round(x));
  const snapY = (y: number) => (snapToGrid ? Math.round(y / 5) * 5 : Math.round(y));

  const fit = useCallback(() => {
    const b = layout.bounds;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!b || !rect) return;
    const zoom = Math.min(
      1.5,
      Math.max(MIN_ZOOM, Math.min((rect.width - 60) / b.width, (rect.height - 60) / b.height)),
    );
    setViewport({
      zoom,
      x: (rect.width - b.width * zoom) / 2 - b.x * zoom,
      y: (rect.height - b.height * zoom) / 2 - b.y * zoom,
    });
  }, [layout.bounds, setViewport]);

  const zoomAround = useCallback(
    (factor: number, center?: Point) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = center?.x ?? (rect ? rect.width / 2 : 0);
      const cy = center?.y ?? (rect ? rect.height / 2 : 0);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
      const k = zoom / viewport.zoom;
      setViewport({ zoom, x: cx - (cx - viewport.x) * k, y: cy - (cy - viewport.y) * k });
    },
    [viewport, setViewport],
  );

  useEffect(() => {
    canvasApi.current = {
      zoomIn: () => zoomAround(1.2),
      zoomOut: () => zoomAround(1 / 1.2),
      resetZoom: () => setViewport({ ...viewport, zoom: 1 }),
      fit,
      getZoom: () => viewport.zoom,
    };
    return () => {
      canvasApi.current = null;
    };
  }, [zoomAround, fit, setViewport, viewport]);

  // First open of a non-empty diagram without a stored viewport: show every lifeline (never
  // enlarging) from the top, since sequence diagrams read downwards.
  useLayoutEffect(() => {
    if (savedViewport || diagram.viewport || Object.keys(diagram.views).length === 0) return;
    const b = layout.bounds;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!b || !rect || rect.width === 0) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(1, (rect.width - 60) / b.width));
    setViewport({ zoom, x: (rect.width - b.width * zoom) / 2 - b.x * zoom, y: 24 - b.y * zoom });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusRequest || focusRequest.diagramId !== diagramId) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const id = focusRequest.viewIds[0];
    if (!rect || !id) return;
    const target =
      layout.lifelines.get(id)?.headBox ??
      layout.messages.get(id)?.labelBounds ??
      layout.fragments.get(id)?.box ??
      layout.activations.get(id)?.box;
    if (!target) return;
    setViewport({
      ...viewport,
      x: rect.width / 2 - (target.x + target.width / 2) * viewport.zoom,
      y: rect.height / 2 - (target.y + target.height / 2) * viewport.zoom,
    });
    // Only react to new requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  useEffect(() => {
    setPendingSource(null);
  }, [tool]);

  const select = (ids: ID[], additive = false) => {
    const current = useEditorStore.getState().selections[diagramId] ?? EMPTY;
    const next = additive
      ? ids.every((id) => current.includes(id))
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])]
      : ids;
    useEditorStore.getState().setSelection(diagramId, next);
  };

  /** Nearest lifeline (by x) under a diagram point. */
  const lifelineAt = (p: Point): ID | null => {
    let best: { id: ID; d: number } | null = null;
    for (const l of layout.lifelines.values()) {
      const d = Math.abs(p.x - l.x);
      const within =
        d <= Math.max(l.headBox.width / 2, 24) && p.y >= l.headBox.y - 10 && p.y <= l.lineBottom + 40;
      if (within && (!best || d < best.d)) best = { id: l.view.id, d };
    }
    return best?.id ?? null;
  };

  // ---------------------------------------------------------------------------------------------
  // Creation tools
  // ---------------------------------------------------------------------------------------------
  const finishTool = (createdViewIds: ID[], edit?: EditTarget) => {
    const editor = useEditorStore.getState();
    editor.setSelection(diagramId, createdViewIds);
    if (!(tool.kind !== 'select' && 'sticky' in tool && tool.sticky)) editor.setTool({ kind: 'select' });
    if (edit && createdViewIds.length === 1)
      editor.setEditing({ diagramId, viewId: createdViewIds[0]!, target: edit });
  };

  const createMessage = (
    toolDef: Extract<ToolDef, { type: 'message' }>,
    source: ID | null,
    target: ID | null,
    y: number,
  ) => {
    const created = createMessageCommands(doc, {
      diagramId,
      sourceViewId: source,
      targetViewId: target,
      sort: toolDef.sort as MessageSort,
      y: snapY(y),
      name: toolDef.sort === 'reply' ? '' : t('defaultName.message'),
      ids: uuidGenerator,
    });
    if (!created.ok || !created.viewId) {
      toast.warning(
        t('canvas.invalidTarget', {
          reason: t(
            created.ok
              ? 'endpoint.notFound'
              : created.reason === 'selfNotAllowed'
                ? 'endpoint.selfNotAllowed'
                : 'endpoint.notFound',
          ),
        }),
      );
      return;
    }
    if (run(created.commands, { label: t('history.add', { name: t('elementKind.message') }) }))
      finishTool([created.viewId], { type: 'label', key: 'name' });
  };

  const placeAt = (p: Point, hit: Hit | null) => {
    if (!activeTool) return;
    switch (activeTool.type) {
      case 'lifeline': {
        const created = createLifelineCommands(doc, {
          diagramId,
          x: snapX(p.x),
          baseName: t('defaultName.lifeline'),
          headStyle: activeTool.headStyle,
          ids: uuidGenerator,
        });
        if (
          created.ok &&
          created.viewId &&
          run(created.commands, { label: t('history.add', { name: t('elementKind.lifeline') }) })
        )
          finishTool([created.viewId], { type: 'name' });
        return;
      }
      case 'activation': {
        const lifeline =
          hit?.kind === 'lifeline' || hit?.kind === 'activation'
            ? hit.kind === 'lifeline'
              ? hit.viewId!
              : layout.activations.get(hit.viewId!)?.view.lifelineViewId
            : lifelineAt(p);
        if (!lifeline) {
          toast.info(t('canvas.sequenceEmptyHint'));
          return;
        }
        const created = createActivationCommands(doc, {
          diagramId,
          lifelineViewId: lifeline,
          startY: snapY(p.y),
          endY: snapY(p.y) + 60,
          ids: uuidGenerator,
        });
        if (
          created.ok &&
          run(created.commands, { label: t('history.add', { name: t('elementKind.activation') }) })
        )
          finishTool(created.createdViewIds);
        return;
      }
      case 'fragment': {
        const created = createFragmentCommands(doc, {
          diagramId,
          operator: activeTool.operator,
          bounds: { x: snapX(p.x - 150), y: snapY(p.y - 20), width: 300, height: 160 },
          ids: uuidGenerator,
        });
        if (
          created.ok &&
          run(created.commands, { label: t('history.add', { name: t('elementKind.combinedFragment') }) })
        )
          finishTool(created.createdViewIds);
        return;
      }
      case 'note': {
        const created = createNoteCommands(
          diagramId,
          { x: snapX(p.x - 80), y: snapY(p.y - 30) },
          { width: 160, height: 60 },
          '',
          uuidGenerator,
        );
        if (created.ok && run(created.commands, { label: t('history.add', { name: t('elementKind.note') }) }))
          finishTool(created.createdViewIds, { type: 'name' });
        return;
      }
      case 'message': {
        const lifeline = lifelineAt(p);
        if (activeTool.mode === 'self') {
          if (lifeline) createMessage(activeTool, lifeline, lifeline, p.y);
          return;
        }
        if (activeTool.mode === 'found') {
          if (lifeline) createMessage(activeTool, null, lifeline, p.y);
          return;
        }
        if (activeTool.mode === 'lost') {
          if (lifeline) createMessage(activeTool, lifeline, null, p.y);
          return;
        }
        if (!lifeline) return;
        if (!pendingSource) setPendingSource({ viewId: lifeline, y: p.y });
        else if (lifeline !== pendingSource.viewId) {
          createMessage(activeTool, pendingSource.viewId, lifeline, pendingSource.y);
          setPendingSource(null);
        } else {
          toast.warning(t('canvas.invalidTarget', { reason: t('endpoint.selfNotAllowed') }));
        }
        return;
      }
      default:
        return;
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    wrapper.current?.focus({ preventScroll: true });
    if (e.button === 2) return;
    const p = toDiagram(e.clientX, e.clientY);
    moved.current = false;
    if (e.button === 1 || panning) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, origin: viewport });
      return;
    }
    const hit = hitAt(e.target);
    if (activeTool) {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (activeTool.type === 'message' && activeTool.mode === 'between' && !pendingSource) {
        const lifeline = lifelineAt(p);
        if (lifeline) {
          setDrag({
            kind: 'newMessage',
            toolId: activeTool.id,
            sourceViewId: lifeline,
            y: p.y,
            start: p,
            current: p,
          });
          return;
        }
      }
      if (activeTool.type === 'fragment' && !hit) {
        setDrag({ kind: 'newFragment', tool: activeTool, start: p, current: p });
        return;
      }
      if (activeTool.type === 'activation') {
        const lifeline = lifelineAt(p);
        if (lifeline) {
          setDrag({ kind: 'newActivation', lifelineViewId: lifeline, start: p, current: p });
          return;
        }
      }
      setDrag({ kind: 'placeClick', start: p, hit });
      return;
    }
    if (tool.kind !== 'select') return;
    if (!hit || !hit.viewId) {
      if (!e.shiftKey) select([]);
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: 'marquee', start: p, current: p });
      return;
    }
    const id = hit.viewId;
    if (!selectedSet.has(id) || e.shiftKey || e.metaKey || e.ctrlKey)
      select([id], e.shiftKey || e.metaKey || e.ctrlKey);
    e.currentTarget.setPointerCapture(e.pointerId);
    switch (hit.kind) {
      case 'lifeline': {
        const l = layout.lifelines.get(id);
        if (l) setDrag({ kind: 'lifeline', viewId: id, start: p, originX: l.view.x });
        break;
      }
      case 'message': {
        const m = layout.messages.get(id);
        if (!m) break;
        if (hit.part === 'label')
          setDrag({ kind: 'messageLabel', viewId: id, start: p, base: m.view.labelOffset });
        else
          setDrag({
            kind: 'message',
            viewId: id,
            start: p,
            origin: { sendY: m.view.sendY, receiveY: m.view.receiveY },
          });
        break;
      }
      case 'activation': {
        const a = layout.activations.get(id);
        if (a)
          setDrag({
            kind: 'activation',
            viewId: id,
            mode: (hit.part as 'top' | 'bottom') ?? 'move',
            start: p,
            origin: { startY: a.view.startY, endY: a.view.endY },
          });
        break;
      }
      case 'fragment': {
        const f = layout.fragments.get(id);
        if (!f) break;
        if (hit.part === 'operand' && hit.operandId)
          setDrag({
            kind: 'operand',
            viewId: id,
            operandId: hit.operandId,
            start: p,
            originY: f.view.operandYs[hit.operandId] ?? p.y,
            originYs: f.view.operandYs,
          });
        else
          setDrag({
            kind: 'fragment',
            viewId: id,
            mode: (hit.part as 'se' | 'e' | 's') ?? 'move',
            start: p,
            origin: f.box,
            originYs: f.view.operandYs,
          });
        break;
      }
      case 'note': {
        const n = layout.notes.get(id);
        if (n)
          setDrag({
            kind: 'note',
            viewId: id,
            mode: hit.part === 'resize' ? 'resize' : 'move',
            start: p,
            origin: { x: n.view.x, y: n.view.y, width: n.layout.width, height: n.layout.height },
          });
        break;
      }
      default:
        break;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toDiagram(e.clientX, e.clientY);
    if (pendingSource) setPointer(p);
    if (!drag) return;
    moved.current = true;
    const dx = p.x - ('start' in drag ? drag.start.x : 0);
    const dy = p.y - ('start' in drag ? drag.start.y : 0);
    switch (drag.kind) {
      case 'pan':
        setViewport({
          ...drag.origin,
          x: drag.origin.x + e.clientX - drag.start.x,
          y: drag.origin.y + e.clientY - drag.start.y,
        });
        break;
      case 'lifeline':
        setOverrides({ lifelineX: new Map([[drag.viewId, snapX(drag.originX + dx)]]) });
        break;
      case 'message': {
        const d = snapY(drag.origin.sendY + dy) - drag.origin.sendY;
        setOverrides({
          messageY: new Map([
            [
              drag.viewId,
              { sendY: Math.max(0, drag.origin.sendY + d), receiveY: Math.max(0, drag.origin.receiveY + d) },
            ],
          ]),
        });
        break;
      }
      case 'messageLabel':
        setOverrides({
          messageLabel: new Map([
            [drag.viewId, { x: Math.round(drag.base.x + dx), y: Math.round(drag.base.y + dy) }],
          ]),
        });
        break;
      case 'activation': {
        const d = snapY(dy);
        const o = drag.origin;
        const next =
          drag.mode === 'move'
            ? { startY: o.startY + d, endY: o.endY + d }
            : drag.mode === 'top'
              ? { startY: Math.min(o.startY + d, o.endY - 10), endY: o.endY }
              : { startY: o.startY, endY: Math.max(o.endY + d, o.startY + 10) };
        setOverrides({ activation: new Map([[drag.viewId, next]]) });
        break;
      }
      case 'fragment': {
        const o = drag.origin;
        const sdx = snapX(dx);
        const sdy = snapY(dy);
        if (drag.mode === 'move') {
          const operandYs = Object.fromEntries(Object.entries(drag.originYs).map(([k, y]) => [k, y + sdy]));
          setOverrides({
            fragment: new Map([
              [drag.viewId, { x: o.x + sdx, y: o.y + sdy, width: o.width, height: o.height, operandYs }],
            ]),
          });
        } else {
          const minBottom = Math.max(o.y + 40, ...Object.values(drag.originYs).map((y) => y + 20));
          setOverrides({
            fragment: new Map([
              [
                drag.viewId,
                {
                  x: o.x,
                  y: o.y,
                  width: drag.mode === 's' ? o.width : Math.max(80, o.width + sdx),
                  height: drag.mode === 'e' ? o.height : Math.max(minBottom - o.y, o.height + sdy),
                },
              ],
            ]),
          });
        }
        break;
      }
      case 'operand': {
        const f = layout.fragments.get(drag.viewId);
        if (!f) break;
        const y = Math.min(f.view.y + f.view.height - 10, Math.max(f.view.y + 22, snapY(drag.originY + dy)));
        setOverrides({
          fragment: new Map([
            [
              drag.viewId,
              {
                x: f.view.x,
                y: f.view.y,
                width: f.view.width,
                height: f.view.height,
                operandYs: { ...drag.originYs, [drag.operandId]: y },
              },
            ],
          ]),
        });
        break;
      }
      case 'note': {
        const o = drag.origin;
        setOverrides({
          note: new Map([
            [
              drag.viewId,
              drag.mode === 'move'
                ? { x: snapX(o.x + dx), y: snapY(o.y + dy) }
                : { x: o.x, y: o.y, width: Math.max(60, o.width + dx), height: Math.max(30, o.height + dy) },
            ],
          ]),
        });
        break;
      }
      case 'marquee':
      case 'newMessage':
      case 'newFragment':
      case 'newActivation':
        setDrag({ ...drag, current: p });
        break;
      default:
        break;
    }
  };

  const commit = (commands: Parameters<typeof run>[0], label: string) => {
    setOverrides({});
    run(commands, { label });
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = toDiagram(e.clientX, e.clientY);
    const dx = 'start' in d ? p.x - d.start.x : 0;
    const dy = 'start' in d ? p.y - d.start.y : 0;
    const changed = moved.current && (Math.abs(dx) > 1 || Math.abs(dy) > 1);
    switch (d.kind) {
      case 'lifeline':
        if (changed)
          commit(
            { type: 'view/update', diagramId, viewId: d.viewId, patch: { x: snapX(d.originX + dx) } },
            t('history.move'),
          );
        else setOverrides({});
        break;
      case 'message': {
        if (!changed) {
          setOverrides({});
          break;
        }
        const delta = snapY(d.origin.sendY + dy) - d.origin.sendY;
        commit(
          {
            type: 'view/update',
            diagramId,
            viewId: d.viewId,
            patch: {
              sendY: Math.max(0, d.origin.sendY + delta),
              receiveY: Math.max(0, d.origin.receiveY + delta),
            },
          },
          t('history.move'),
        );
        break;
      }
      case 'messageLabel':
        if (changed)
          commit(
            {
              type: 'view/update',
              diagramId,
              viewId: d.viewId,
              patch: { labelOffset: { x: Math.round(d.base.x + dx), y: Math.round(d.base.y + dy) } },
            },
            t('history.move'),
          );
        else setOverrides({});
        break;
      case 'activation': {
        const next = overrides.activation?.get(d.viewId);
        if (changed && next)
          commit({ type: 'view/update', diagramId, viewId: d.viewId, patch: next }, t('history.resize'));
        else setOverrides({});
        break;
      }
      case 'fragment':
      case 'operand': {
        const next = overrides.fragment?.get(d.viewId);
        if (changed && next)
          commit(
            {
              type: 'view/update',
              diagramId,
              viewId: d.viewId,
              patch: {
                x: next.x,
                y: next.y,
                width: next.width,
                height: next.height,
                ...(next.operandYs ? { operandYs: next.operandYs } : {}),
              },
            },
            t('history.resize'),
          );
        else setOverrides({});
        break;
      }
      case 'note': {
        const next = overrides.note?.get(d.viewId);
        if (changed && next)
          commit({ type: 'view/update', diagramId, viewId: d.viewId, patch: next }, t('history.move'));
        else setOverrides({});
        break;
      }
      case 'marquee': {
        const x1 = Math.min(d.start.x, d.current.x);
        const y1 = Math.min(d.start.y, d.current.y);
        const x2 = Math.max(d.start.x, d.current.x);
        const y2 = Math.max(d.start.y, d.current.y);
        if (x2 - x1 < 3 && y2 - y1 < 3) break;
        const inside = (b: { x: number; y: number; width: number; height: number }) =>
          b.x < x2 && b.x + b.width > x1 && b.y < y2 && b.y + b.height > y1;
        const ids = [
          ...[...layout.lifelines.values()].filter((l) => inside(l.headBox)).map((l) => l.view.id),
          ...[...layout.messages.values()]
            .filter(
              (m) =>
                inside(m.labelBounds) ||
                m.points.some((q) => q.x >= x1 && q.x <= x2 && q.y >= y1 && q.y <= y2),
            )
            .map((m) => m.view.id),
          ...[...layout.activations.values()].filter((a) => inside(a.box)).map((a) => a.view.id),
          ...[...layout.fragments.values()].filter((f) => inside(f.box)).map((f) => f.view.id),
          ...[...layout.notes.values()]
            .filter((n) =>
              inside({ x: n.view.x, y: n.view.y, width: n.layout.width, height: n.layout.height }),
            )
            .map((n) => n.view.id),
        ];
        select(ids, e.shiftKey);
        break;
      }
      case 'newMessage': {
        const def = findTool(d.toolId);
        const target = lifelineAt(p);
        if (def?.type !== 'message') break;
        if (!changed || target === d.sourceViewId || !target) {
          // A click (no drag): two-stage mode, the source is pending.
          if (!changed) setPendingSource({ viewId: d.sourceViewId, y: d.y });
          else if (target === d.sourceViewId)
            toast.warning(t('canvas.invalidTarget', { reason: t('endpoint.selfNotAllowed') }));
          break;
        }
        createMessage(def, d.sourceViewId, target, d.y);
        break;
      }
      case 'newFragment': {
        const x = Math.min(d.start.x, d.current.x);
        const y = Math.min(d.start.y, d.current.y);
        const w = Math.abs(d.current.x - d.start.x);
        const h = Math.abs(d.current.y - d.start.y);
        if (w < 20 || h < 20) placeAt(d.start, null);
        else {
          const created = createFragmentCommands(doc, {
            diagramId,
            operator: d.tool.operator,
            bounds: {
              x: snapX(x),
              y: snapY(y),
              width: Math.max(80, snapX(w)),
              height: Math.max(50, snapY(h)),
            },
            ids: uuidGenerator,
          });
          if (
            created.ok &&
            run(created.commands, { label: t('history.add', { name: t('elementKind.combinedFragment') }) })
          )
            finishTool(created.createdViewIds);
        }
        break;
      }
      case 'placeClick':
        placeAt(d.start, d.hit);
        break;
      case 'newActivation': {
        const y1 = Math.min(d.start.y, d.current.y);
        const y2 = Math.max(d.start.y, d.current.y);
        const created = createActivationCommands(doc, {
          diagramId,
          lifelineViewId: d.lifelineViewId,
          startY: snapY(y1),
          endY: y2 - y1 < 10 ? snapY(y1) + 60 : snapY(y2),
          ids: uuidGenerator,
        });
        if (
          created.ok &&
          run(created.commands, { label: t('history.add', { name: t('elementKind.activation') }) })
        )
          finishTool(created.createdViewIds);
        break;
      }
      default:
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool.kind !== 'select') return;
    const hit = hitAt(e.target);
    if (!hit?.viewId) return;
    const editor = useEditorStore.getState();
    if (hit.kind === 'lifeline' || hit.kind === 'note')
      editor.setEditing({ diagramId, viewId: hit.viewId, target: { type: 'name' } });
    else if (hit.kind === 'message')
      editor.setEditing({ diagramId, viewId: hit.viewId, target: { type: 'label', key: 'name' } });
    else if (hit.kind === 'fragment') {
      const f = layout.fragments.get(hit.viewId);
      const p = toDiagram(e.clientX, e.clientY);
      const operand = f?.operands.find((o) => p.y >= o.top && p.y <= o.bottom) ?? f?.operands[0];
      if (operand)
        editor.setEditing({
          diagramId,
          viewId: hit.viewId,
          target: { type: 'member', collection: 'operands', memberId: operand.id },
        });
    }
  };

  const onWheel = (e: WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey || e.metaKey) {
      zoomAround(Math.exp(-e.deltaY * 0.0025), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setViewport({
        ...viewport,
        x: viewport.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: viewport.y - (e.shiftKey ? 0 : e.deltaY),
      });
    }
  };

  // Native non-passive wheel listener so ctrl+wheel (pinch) does not zoom the whole page.
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const prevent = (ev: globalThis.WheelEvent) => ev.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const messages = selection.filter((id) => layout.messages.has(id));
    if (!messages.length) return;
    e.preventDefault();
    const step = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 20 : 5);
    const patches = Object.fromEntries(
      messages.map((id) => {
        const v = layout.messages.get(id)!.view;
        return [id, { sendY: Math.max(0, v.sendY + step), receiveY: Math.max(0, v.receiveY + step) }];
      }),
    );
    run(
      { type: 'view/updateMany', diagramId, patches },
      { label: t('history.move'), mergeKey: `seq-nudge:${messages.join(',')}` },
    );
  };

  // Explorer drop: a classifier/actor becomes a typed lifeline (`:Type`), semantics are referenced.
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_ELEMENT_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const elementId = e.dataTransfer.getData(DRAG_ELEMENT_MIME);
    const el = elementId ? doc.modelElements[elementId] : undefined;
    if (!el) return;
    e.preventDefault();
    const typable = ['class', 'interface', 'actor', 'component', 'dataType', 'signal'].includes(el.kind);
    if (!typable) {
      toast.warning(t('canvas.droppedNotAllowed', { name: el.name, diagram: t('diagramKind.sequence') }));
      return;
    }
    const p = toDiagram(e.clientX, e.clientY);
    const created = createLifelineCommands(doc, {
      diagramId,
      x: snapX(p.x),
      baseName: t('defaultName.lifeline'),
      headStyle: el.kind === 'actor' ? 'actor' : 'object',
      typeElementId: el.id,
      ids: uuidGenerator,
    });
    if (created.ok && created.viewId && run(created.commands, { label: t('history.add', { name: el.name }) }))
      finishTool([created.viewId]);
  };

  // ---------------------------------------------------------------------------------------------
  // Inline editor
  // ---------------------------------------------------------------------------------------------
  const editor = useMemo(() => {
    if (!editing || editing.diagramId !== diagramId) return null;
    const id = editing.viewId;
    let box: { x: number; y: number; width: number; height: number } | null = null;
    let multiline = false;
    const l = layout.lifelines.get(id);
    const m = layout.messages.get(id);
    const f = layout.fragments.get(id);
    const n = layout.notes.get(id);
    if (l)
      box = {
        x: l.headBox.x,
        y: l.headBox.y + l.headBox.height / 2 - 11,
        width: Math.max(l.headBox.width, 140),
        height: 22,
      };
    else if (m)
      box = {
        x: m.labelBounds.x - 10,
        y: m.labelBounds.y - 3,
        width: Math.max(160, m.labelBounds.width + 20),
        height: 22,
      };
    else if (f && editing.target.type === 'member') {
      const memberId = editing.target.memberId;
      const operand = f.operands.find((o) => o.id === memberId);
      if (operand)
        box = {
          x: operand.guardBox.x,
          y: operand.guardBox.y,
          width: Math.max(160, operand.guardBox.width),
          height: 22,
        };
    } else if (n) {
      box = {
        x: n.view.x + 4,
        y: n.view.y + 4,
        width: n.layout.width - 8,
        height: Math.max(48, n.layout.height - 8),
      };
      multiline = true;
    }
    if (!box) return null;
    return { box, multiline, initial: initialEditText(doc, diagram, id, editing.target) };
  }, [editing, diagramId, layout, doc, diagram]);

  const commitEdit = (text: string): boolean => {
    const current = useEditorStore.getState().editing;
    const latest = useDocumentStore.getState().doc;
    if (!current || !latest) return true;
    const result = commitInlineEdit(
      latest,
      latest.diagrams[diagramId]!,
      current.viewId,
      current.target,
      text,
      uuidGenerator,
    );
    if (!result.ok) {
      toast.error(t('canvas.invalidMemberText', { text }));
      return false;
    }
    useEditorStore.getState().setEditing(null);
    if (result.commands.length) run(result.commands, { label: t('history.rename') });
    wrapper.current?.focus({ preventScroll: true });
    return true;
  };

  const menuEntries = (): MenuEntry[] => {
    const current = useEditorStore.getState().selections[diagramId] ?? [];
    if (!current.length) {
      return [
        {
          label: t('cmd.paste'),
          shortcut: primaryShortcut('edit.paste'),
          disabled: !useEditorStore.getState().clipboard,
          onSelect: pasteClipboard,
        },
        { label: t('cmd.fitDiagram'), shortcut: primaryShortcut('view.fit'), onSelect: fit },
        {
          label: t('cmd.exportImage'),
          onSelect: () => useEditorStore.getState().openDialog({ type: 'export', diagramId }),
        },
      ];
    }
    const single = current.length === 1 ? diagram.views[current[0]!] : undefined;
    const entries: MenuEntry[] = [];
    if (single && single.kind !== 'activation')
      entries.push({ label: t('cmd.rename'), shortcut: 'F2', onSelect: renameSelection });
    if (single?.kind === 'message') {
      const msg = doc.modelElements[single.elementId];
      if (msg?.kind === 'message') {
        entries.push({
          type: 'submenu',
          label: t('inspector.messageSort'),
          children: (['synchronous', 'asynchronous', 'reply', 'create', 'destroy'] as const).map((sort) => ({
            label: t(`messageSort.${sort}`),
            checked: msg.sort === sort,
            onSelect: () =>
              run(
                { type: 'element/update', elementId: msg.id, patch: { sort } },
                { label: t('history.edit', { field: t('inspector.messageSort') }) },
              ),
          })),
        });
      }
    }
    entries.push(
      { type: 'separator' },
      {
        label: t('cmd.copy'),
        shortcut: primaryShortcut('edit.copy'),
        onSelect: () => void copySelectionToClipboard(),
      },
      {
        label: t('cmd.paste'),
        shortcut: primaryShortcut('edit.paste'),
        disabled: !useEditorStore.getState().clipboard,
        onSelect: pasteClipboard,
      },
      {
        label: t('cmd.duplicate'),
        shortcut: primaryShortcut('edit.duplicate'),
        onSelect: duplicateSelection,
      },
      { type: 'separator' },
      {
        label: t('cmd.delete'),
        shortcut: primaryShortcut('edit.delete'),
        onSelect: removeSelectionFromDiagram,
      },
      { label: t('cmd.deleteFromModel'), danger: true, onSelect: () => requestDeleteFromModel() },
    );
    return entries;
  };

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------
  const selectionColor = 'var(--selection)';
  const z = viewport.zoom;
  const handle = 6 / z;
  const isEmpty = layout.lifelines.size === 0 && layout.notes.size === 0;
  const pendingLifeline = pendingSource ? layout.lifelines.get(pendingSource.viewId) : undefined;
  const dragPreview =
    drag?.kind === 'newMessage'
      ? { from: { x: layout.lifelines.get(drag.sourceViewId)?.x ?? 0, y: drag.y }, to: drag.current }
      : pendingLifeline && pointer
        ? { from: { x: pendingLifeline.x, y: pendingSource!.y }, to: pointer }
        : null;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={wrapper}
          className="relative h-full w-full overflow-hidden outline-none"
          style={{
            background: 'var(--canvas)',
            cursor: panning ? 'grab' : activeTool ? 'crosshair' : 'default',
          }}
          tabIndex={0}
          data-canvas="sequence"
          data-testid="sequence-canvas"
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onContextMenuCapture={(e) => {
            const hit = hitAt(e.target);
            if (hit?.viewId && !selectedSet.has(hit.viewId)) select([hit.viewId]);
          }}
        >
          <svg
            ref={svgRef}
            className="absolute inset-0 h-full w-full touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
            role="application"
            aria-label={diagram.name}
          >
            {showGrid && (
              <defs>
                <pattern
                  id={`seq-grid-${diagramId}`}
                  width={gridSize * 2 * z}
                  height={gridSize * 2 * z}
                  patternUnits="userSpaceOnUse"
                  x={viewport.x}
                  y={viewport.y}
                >
                  <circle cx={1} cy={1} r={0.9} fill="var(--canvas-grid)" />
                </pattern>
              </defs>
            )}
            {showGrid && <rect width="100%" height="100%" fill={`url(#seq-grid-${diagramId})`} />}
            <g transform={`translate(${viewport.x} ${viewport.y}) scale(${z})`}>
              {/* Fragments (below everything) */}
              {[...layout.fragments.values()].map((f) => (
                <g
                  key={f.view.id}
                  data-testid="seq-fragment"
                  data-view-id={f.view.id}
                  data-operator={f.element.operator}
                >
                  <PrimitiveSvg primitives={f.primitives} />
                  <rect
                    x={f.box.x}
                    y={f.box.y}
                    width={f.box.width}
                    height={f.box.height}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10 / z}
                    data-hit-kind="fragment"
                    data-view={f.view.id}
                    pointerEvents="stroke"
                  />
                  <rect
                    x={f.tagBox.x}
                    y={f.tagBox.y}
                    width={f.tagBox.width}
                    height={f.tagBox.height}
                    fill="transparent"
                    data-hit-kind="fragment"
                    data-view={f.view.id}
                    data-testid="seq-fragment-tag"
                    style={{ cursor: 'move' }}
                  />
                  {f.operands.map((o) => (
                    <rect
                      key={o.id}
                      x={o.guardBox.x}
                      y={o.guardBox.y}
                      width={o.guardBox.width}
                      height={o.guardBox.height}
                      fill="transparent"
                      data-hit-kind="fragment"
                      data-view={f.view.id}
                      data-testid="seq-operand-guard"
                    />
                  ))}
                  {selectedSet.has(f.view.id) && (
                    <>
                      <rect
                        x={f.box.x}
                        y={f.box.y}
                        width={f.box.width}
                        height={f.box.height}
                        fill="none"
                        stroke={selectionColor}
                        strokeWidth={1.5 / z}
                        strokeDasharray={`${4 / z} ${3 / z}`}
                        pointerEvents="none"
                      />
                      {f.operands.slice(1).map((o) => (
                        <rect
                          key={o.id}
                          x={f.box.x}
                          y={o.top - 4 / z}
                          width={f.box.width}
                          height={8 / z}
                          fill={selectionColor}
                          fillOpacity={0.15}
                          style={{ cursor: 'ns-resize' }}
                          data-hit-kind="fragment"
                          data-view={f.view.id}
                          data-part="operand"
                          data-operand={o.id}
                          data-testid="seq-operand-divider"
                        />
                      ))}
                      <rect
                        x={f.box.x + f.box.width - handle}
                        y={f.box.y + f.box.height - handle}
                        width={handle * 2}
                        height={handle * 2}
                        fill={selectionColor}
                        style={{ cursor: 'nwse-resize' }}
                        data-hit-kind="fragment"
                        data-view={f.view.id}
                        data-part="se"
                        data-testid="seq-fragment-resize"
                      />
                    </>
                  )}
                </g>
              ))}
              {/* Lifelines */}
              {[...layout.lifelines.values()].map((l) => (
                <g
                  key={l.view.id}
                  data-testid="seq-lifeline"
                  data-view-id={l.view.id}
                  data-name={l.label}
                  data-x={l.x}
                >
                  <PrimitiveSvg primitives={l.primitives} />
                  <rect
                    x={l.headBox.x}
                    y={l.headBox.y}
                    width={l.headBox.width}
                    height={l.headBox.height}
                    fill="transparent"
                    data-hit-kind="lifeline"
                    data-view={l.view.id}
                    style={{ cursor: 'ew-resize' }}
                  />
                  <line
                    x1={l.x}
                    y1={l.lineTop}
                    x2={l.x}
                    y2={l.lineBottom}
                    stroke="transparent"
                    strokeWidth={14 / z}
                    data-hit-kind="lifeline"
                    data-view={l.view.id}
                  />
                  {selectedSet.has(l.view.id) && (
                    <rect
                      x={l.headBox.x - 3}
                      y={l.headBox.y - 3}
                      width={l.headBox.width + 6}
                      height={l.headBox.height + 6}
                      rx={3}
                      fill="none"
                      stroke={selectionColor}
                      strokeWidth={1.5 / z}
                      strokeDasharray={`${4 / z} ${3 / z}`}
                      pointerEvents="none"
                    />
                  )}
                </g>
              ))}
              {/* Activations */}
              {[...layout.activations.values()].map((a) => (
                <g key={a.view.id} data-testid="seq-activation" data-view-id={a.view.id}>
                  <PrimitiveSvg primitives={a.primitives} />
                  <rect
                    x={a.box.x - 2}
                    y={a.box.y}
                    width={a.box.width + 4}
                    height={a.box.height}
                    fill="transparent"
                    data-hit-kind="activation"
                    data-view={a.view.id}
                    style={{ cursor: 'ns-resize' }}
                  />
                  {selectedSet.has(a.view.id) && (
                    <>
                      <rect
                        x={a.box.x - 2}
                        y={a.box.y - 2}
                        width={a.box.width + 4}
                        height={a.box.height + 4}
                        fill="none"
                        stroke={selectionColor}
                        strokeWidth={1.5 / z}
                        pointerEvents="none"
                      />
                      <rect
                        x={a.box.x - 2}
                        y={a.box.y - handle / 2}
                        width={a.box.width + 4}
                        height={handle}
                        fill={selectionColor}
                        data-hit-kind="activation"
                        data-view={a.view.id}
                        data-part="top"
                        style={{ cursor: 'ns-resize' }}
                      />
                      <rect
                        x={a.box.x - 2}
                        y={a.box.y + a.box.height - handle / 2}
                        width={a.box.width + 4}
                        height={handle}
                        fill={selectionColor}
                        data-hit-kind="activation"
                        data-view={a.view.id}
                        data-part="bottom"
                        style={{ cursor: 'ns-resize' }}
                      />
                    </>
                  )}
                </g>
              ))}
              {/* Fragment tags and guards stay readable above lifelines/activations */}
              {[...layout.fragments.values()].map((f) => (
                <g key={`${f.view.id}-overlay`} pointerEvents="none">
                  <PrimitiveSvg primitives={f.overlay} />
                </g>
              ))}
              {/* Messages */}
              {[...layout.messages.values()].map((m) => (
                <g
                  key={m.view.id}
                  data-testid="seq-message"
                  data-view-id={m.view.id}
                  data-sort={m.element.sort}
                  data-send-y={m.view.sendY}
                  data-order={m.number}
                  data-name={m.element.name}
                >
                  {selectedSet.has(m.view.id) && (
                    <polyline
                      points={m.points.map((q) => `${q.x},${q.y}`).join(' ')}
                      fill="none"
                      stroke={selectionColor}
                      strokeOpacity={0.3}
                      strokeWidth={7}
                      pointerEvents="none"
                    />
                  )}
                  <PrimitiveSvg primitives={m.primitives} />
                  <polyline
                    points={m.points.map((q) => `${q.x},${q.y}`).join(' ')}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12 / z}
                    data-hit-kind="message"
                    data-view={m.view.id}
                    style={{ cursor: 'ns-resize' }}
                  />
                  {m.labelText && (
                    <rect
                      x={m.labelBounds.x}
                      y={m.labelBounds.y}
                      width={m.labelBounds.width}
                      height={m.labelBounds.height}
                      fill="transparent"
                      data-hit-kind="message"
                      data-view={m.view.id}
                      data-part="label"
                      style={{ cursor: 'move' }}
                    />
                  )}
                </g>
              ))}
              {/* Notes */}
              {[...layout.notes.values()].map((n) => (
                <g
                  key={n.view.id}
                  transform={`translate(${n.view.x} ${n.view.y})`}
                  data-testid="seq-note"
                  data-view-id={n.view.id}
                >
                  <PrimitiveSvg primitives={n.layout.primitives} />
                  <rect
                    width={n.layout.width}
                    height={n.layout.height}
                    fill="transparent"
                    data-hit-kind="note"
                    data-view={n.view.id}
                    style={{ cursor: 'move' }}
                  />
                  {selectedSet.has(n.view.id) && (
                    <>
                      <rect
                        x={-3}
                        y={-3}
                        width={n.layout.width + 6}
                        height={n.layout.height + 6}
                        fill="none"
                        stroke={selectionColor}
                        strokeWidth={1.5 / z}
                        strokeDasharray={`${4 / z} ${3 / z}`}
                        pointerEvents="none"
                      />
                      <rect
                        x={n.layout.width - handle}
                        y={n.layout.height - handle}
                        width={handle * 2}
                        height={handle * 2}
                        fill={selectionColor}
                        data-hit-kind="note"
                        data-view={n.view.id}
                        data-part="resize"
                        style={{ cursor: 'nwse-resize' }}
                      />
                    </>
                  )}
                </g>
              ))}
              {dragPreview && (
                <line
                  x1={dragPreview.from.x}
                  y1={dragPreview.from.y}
                  x2={dragPreview.to.x}
                  y2={dragPreview.from.y}
                  stroke={selectionColor}
                  strokeWidth={1.5 / z}
                  strokeDasharray={`${5 / z} ${4 / z}`}
                  pointerEvents="none"
                />
              )}
              {drag?.kind === 'marquee' && (
                <rect
                  x={Math.min(drag.start.x, drag.current.x)}
                  y={Math.min(drag.start.y, drag.current.y)}
                  width={Math.abs(drag.current.x - drag.start.x)}
                  height={Math.abs(drag.current.y - drag.start.y)}
                  fill="rgb(75 139 245 / 0.08)"
                  stroke={selectionColor}
                  strokeWidth={1 / z}
                  strokeDasharray={`${4 / z} ${3 / z}`}
                  pointerEvents="none"
                />
              )}
              {(drag?.kind === 'newFragment' || drag?.kind === 'newActivation') && (
                <rect
                  x={
                    drag.kind === 'newActivation'
                      ? (layout.lifelines.get(drag.lifelineViewId)?.x ?? 0) - 6
                      : Math.min(drag.start.x, drag.current.x)
                  }
                  y={Math.min(drag.start.y, drag.current.y)}
                  width={drag.kind === 'newActivation' ? 12 : Math.abs(drag.current.x - drag.start.x)}
                  height={Math.abs(drag.current.y - drag.start.y)}
                  fill="none"
                  stroke={selectionColor}
                  strokeWidth={1.2 / z}
                  strokeDasharray={`${4 / z} ${3 / z}`}
                  pointerEvents="none"
                />
              )}
            </g>
          </svg>
          {editor && (
            <InlineTextEditor
              key={`${editing!.viewId}:${JSON.stringify(editing!.target)}`}
              style={{
                left: viewport.x + editor.box.x * z,
                top: viewport.y + editor.box.y * z,
                width: editor.box.width * z,
                height: editor.box.height * z,
              }}
              initial={editor.initial}
              multiline={editor.multiline}
              fontSize={13 * z}
              ariaLabel={t('cmd.rename')}
              onCommit={commitEdit}
              onCancel={() => {
                useEditorStore.getState().setEditing(null);
                wrapper.current?.focus({ preventScroll: true });
              }}
            />
          )}
          {isEmpty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-sm rounded-lg border border-dashed border-border-strong bg-surface-1/70 px-5 py-4 text-center text-[12.5px] text-muted">
                {t('canvas.sequenceEmptyHint')}
              </div>
            </div>
          )}
          {activeTool?.type === 'message' && activeTool.mode === 'between' && (
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
  );
}
