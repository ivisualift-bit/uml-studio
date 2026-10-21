import { run } from '@/app/actions';
import {
  checkConnection,
  createNodeCommands,
  createNoteCommands,
  createNoteLinkCommands,
  createRelationshipCommands,
  presetKind,
  showElementCommands,
} from '@/domain/commands/creators';
import type { Command } from '@/domain/commands/types';
import { uuidGenerator } from '@/domain/ids';
import { diagramAllowsElement } from '@/domain/model/metadata';
import type { ID, Point } from '@/domain/schemas/common';
import { isRelationship } from '@/domain/schemas/elements';
import { defaultSizeFor, findTool, type ToolDef } from '@/diagrams/registry/catalog';
import { hasMessage, t, type MessageKey } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';

export const DRAG_ELEMENT_MIME = 'application/x-umlstudio-element';
export const DRAG_TOOL_MIME = 'application/x-umlstudio-tool';

const snap = (value: number) => {
  const { snapToGrid, gridSize } = useSettingsStore.getState();
  return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value);
};

const NAMELESS = new Set(['controlNode', 'pseudostate', 'finalState']);

function baseNameFor(kind: string): string {
  const key = `defaultName.${kind}`;
  return hasMessage(key) ? t(key as MessageKey) : kind;
}

function afterCreate(diagramId: ID, viewIds: ID[], editName: boolean): void {
  const editor = useEditorStore.getState();
  editor.setSelection(diagramId, viewIds);
  const tool = editor.tool;
  if (tool.kind !== 'select' && !('sticky' in tool && tool.sticky)) editor.setTool({ kind: 'select' });
  if (editName && viewIds.length === 1)
    editor.setEditing({ diagramId, viewId: viewIds[0]!, target: { type: 'name' } });
}

/** Place a node/note tool with its top-left corner centred on `point`. */
export function placeTool(diagramId: ID, tool: ToolDef, point: Point): boolean {
  const doc = useDocumentStore.getState().doc;
  if (!doc) return false;
  if (tool.type === 'note') {
    const size = { width: 160, height: 64 };
    const created = createNoteCommands(
      diagramId,
      { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) },
      size,
      '',
      uuidGenerator,
    );
    if (!created.ok || !run(created.commands, { label: t('history.add', { name: t('elementKind.note') }) }))
      return false;
    afterCreate(diagramId, created.createdViewIds, true);
    return true;
  }
  if (tool.type !== 'node') return false;
  const size = tool.size;
  const created = createNodeCommands(doc, {
    diagramId,
    spec: { ...tool.spec, baseName: baseNameFor(tool.spec.kind) },
    position: { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) },
    size,
    ids: uuidGenerator,
  });
  if (!created.ok || !created.elementId || !created.viewId) {
    if (!created.ok && created.reason === 'noOwner') {
      const container =
        tool.spec.kind === 'port'
          ? `${t('elementKind.component')} / ${t('elementKind.class')}`
          : `${t('elementKind.class')} / ${t('elementKind.component')}`;
      toast.warning(t('canvas.needsContainer', { kind: t(`elementKind.${tool.spec.kind}`), container }));
    } else toast.error(t('commandError.viewNotAllowed'));
    return false;
  }
  const commands: Command[] = [...created.commands];
  if (tool.init) commands.push({ type: 'element/update', elementId: created.elementId, patch: tool.init });
  if (tool.variant)
    commands.push({
      type: 'view/update',
      diagramId,
      viewId: created.viewId,
      patch: { variant: tool.variant },
    });
  if (!run(commands, { label: t('history.add', { name: t(`elementKind.${tool.spec.kind}`) }) })) return false;
  afterCreate(diagramId, [created.viewId], !NAMELESS.has(tool.spec.kind));
  return true;
}

export function connectionProblem(
  diagramId: ID,
  toolId: string,
  sourceViewId: ID,
  targetViewId: ID,
): string | null {
  const doc = useDocumentStore.getState().doc;
  const diagram = doc?.diagrams[diagramId];
  const tool = findTool(toolId);
  if (!doc || !diagram || !tool) return 'notFound';
  if (tool.type === 'noteLink') {
    const source = diagram.views[sourceViewId];
    return source?.kind === 'note' && sourceViewId !== targetViewId ? null : 'notAllowed';
  }
  if (tool.type !== 'relationship') return 'notAllowed';
  return checkConnection(doc, diagram, tool.preset, sourceViewId, targetViewId);
}

/** Second stage of the connector tool. */
export function completeConnection(
  diagramId: ID,
  toolId: string,
  sourceViewId: ID,
  targetViewId: ID,
): boolean {
  const doc = useDocumentStore.getState().doc;
  const diagram = doc?.diagrams[diagramId];
  const tool = findTool(toolId);
  if (!doc || !diagram || !tool) return false;
  if (tool.type === 'noteLink') {
    const created = createNoteLinkCommands(diagram, sourceViewId, targetViewId, uuidGenerator);
    if (!created.ok) {
      toast.warning(t('canvas.invalidTarget', { reason: t('endpoint.notAllowed') }));
      return false;
    }
    if (!run(created.commands, { label: t('history.connect', { kind: t('elementKind.noteLink') }) }))
      return false;
    afterCreate(diagramId, created.createdViewIds, false);
    return true;
  }
  if (tool.type !== 'relationship') return false;
  const created = createRelationshipCommands(doc, {
    diagramId,
    preset: tool.preset,
    sourceViewId,
    targetViewId,
    ids: uuidGenerator,
  });
  if (!created.ok) {
    toast.warning(t('canvas.invalidTarget', { reason: t(`endpoint.${created.reason}`) }));
    return false;
  }
  if (
    !run(created.commands, {
      label: t('history.connect', { kind: t(`elementKind.${presetKind(tool.preset)}`) }),
    })
  )
    return false;
  afterCreate(diagramId, [created.edgeViewId], false);
  return true;
}

/** Explorer → canvas: add a VIEW of an existing element (semantics are never cloned). */
export function dropExistingElement(diagramId: ID, elementId: ID, point: Point): void {
  const doc = useDocumentStore.getState().doc;
  const diagram = doc?.diagrams[diagramId];
  const el = doc?.modelElements[elementId];
  if (!doc || !diagram || !el) return;
  if (isRelationship(el) || !diagramAllowsElement(diagram.kind, el.kind)) {
    toast.warning(
      t('canvas.droppedNotAllowed', {
        name: el.name || t(`elementKind.${el.kind}`),
        diagram: t(`diagramKind.${diagram.kind}`),
      }),
    );
    return;
  }
  const subKind =
    el.kind === 'controlNode' ? el.nodeKind : el.kind === 'pseudostate' ? el.pseudoKind : undefined;
  const size = defaultSizeFor(el.kind, subKind);
  const created = showElementCommands(doc, {
    diagramId,
    elementId,
    position: { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) },
    size,
    ids: uuidGenerator,
  });
  if (!created.ok) {
    toast.warning(
      t('canvas.droppedNotAllowed', { name: el.name, diagram: t(`diagramKind.${diagram.kind}`) }),
    );
    return;
  }
  if (run(created.commands, { label: t('history.add', { name: el.name }) }))
    useEditorStore.getState().setSelection(diagramId, created.createdViewIds);
}
