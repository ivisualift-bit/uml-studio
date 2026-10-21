import { copySelection, createDiagramCommands, pasteCommands } from '@/domain/commands/creators';
import type { CommandOutcome } from '@/domain/commands/engine';
import type { Command } from '@/domain/commands/types';
import { uuidGenerator } from '@/domain/ids';
import { createEmptyProject, makeAttribute, makeLiteral, makeOperation } from '@/domain/model/factory';
import type { ID } from '@/domain/schemas/common';
import { hasFeatures, isRelationship } from '@/domain/schemas/elements';
import type { DiagramKind, ProjectDocument } from '@/domain/schemas/project';
import { isBoxView } from '@/domain/schemas/views';
import { parseProjectText, serializeProject } from '@/domain/serialization/projectFile';
import { viewsOfElement } from '@/domain/services/queries';
import { validateProject } from '@/domain/validation/rules';
import { layoutGraphDiagram } from '@/diagrams/render/graphLayout';
import { PRINT_THEME } from '@/diagrams/render/theme';
import { DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import { t, type MessageKey } from '@/i18n';
import { projectRepository, recoveryRepository } from '@/services/platform/platform';
import type { RecentEntry } from '@/services/persistence/types';
import { importMdj } from '@/services/import/mdjImport';
import { instantiateTemplate } from '@/services/templates/templates';
import { selectIsDirty, useDocumentStore, type DispatchOptions, type FileRef } from '@/stores/documentStore';
import { activeSelection, useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { canvasApi } from './canvasApi';

// -------------------------------------------------------------------------------------------------
// Dispatch helpers
// -------------------------------------------------------------------------------------------------

export function describeFailure(outcome: Extract<CommandOutcome, { ok: false }>): string {
  return t(`commandError.${outcome.code}` as MessageKey);
}

/** Dispatch through the command bus; failures are surfaced to the user, never swallowed. */
export function run(commands: Command | Command[], options: DispatchOptions): boolean {
  const outcome = useDocumentStore.getState().dispatch(commands, options);
  if (!outcome.ok) {
    toast.error(describeFailure(outcome), { details: [outcome.message, ...outcome.details].slice(0, 6) });
    return false;
  }
  syncEditorWithDocument();
  return true;
}

/** Drop tabs/selections that point to things that no longer exist (after delete/undo). */
export function syncEditorWithDocument(): void {
  const doc = useDocumentStore.getState().doc;
  const editor = useEditorStore.getState();
  if (!doc) return;
  editor.pruneTabs(new Set(Object.keys(doc.diagrams)));
  for (const [diagramId, ids] of Object.entries(editor.selections)) {
    const diagram = doc.diagrams[diagramId];
    if (!diagram) continue;
    const kept = ids.filter((id) => diagram.views[id]);
    if (kept.length !== ids.length) editor.setSelection(diagramId, kept);
  }
  const explorer = editor.explorerSelection;
  if (explorer && !doc.modelElements[explorer] && !doc.diagrams[explorer]) editor.selectInExplorer(null);
}

function currentDoc(): ProjectDocument | null {
  return useDocumentStore.getState().doc;
}

// -------------------------------------------------------------------------------------------------
// Project lifecycle
// -------------------------------------------------------------------------------------------------

/** Resolves true when it is OK to replace the current project (saved, discarded or clean). */
export function confirmDiscardIfDirty(): Promise<boolean> {
  const state = useDocumentStore.getState();
  if (!state.doc || !selectIsDirty(state)) return Promise.resolve(true);
  return new Promise((resolve) => {
    useEditorStore.getState().openDialog({
      type: 'unsaved',
      projectName: state.doc!.name,
      onDecision: async (decision) => {
        useEditorStore.getState().closeDialog();
        if (decision === 'cancel') return resolve(false);
        if (decision === 'save') return resolve(await saveProject());
        resolve(true);
      },
    });
  });
}

async function replaceProject(
  doc: ProjectDocument,
  file: FileRef | null,
  options: { dirty?: boolean } = {},
): Promise<void> {
  const previous = currentDoc();
  // The previous project's recovery snapshot is no longer needed once the user chose to replace it.
  if (previous && previous.id !== doc.id)
    await recoveryRepository()
      .deleteRecovery(previous.id)
      .catch(() => undefined);
  useEditorStore.getState().reset();
  useDocumentStore.getState().load(doc, file, options);
  const first = Object.values(doc.diagrams)[0];
  if (first) useEditorStore.getState().openDiagram(first.id);
  for (const diagram of Object.values(doc.diagrams)) {
    if (diagram.viewport) useEditorStore.getState().setViewport(diagram.id, diagram.viewport);
  }
}

export async function newProject(name?: string, templateId?: string): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  const now = new Date();
  const doc =
    templateId && templateId !== 'blank'
      ? instantiateTemplate(templateId, uuidGenerator, now, name || undefined)
      : createEmptyProject({
          name: name || t('project.defaultName'),
          modelName: t('project.modelName'),
          ids: uuidGenerator,
          now,
        });
  await replaceProject(doc, null, { dirty: false });
}

export function showLoadError(fileName: string, text: string): ProjectDocument | null {
  const result = parseProjectText(text);
  if (result.ok) return result.doc;
  useEditorStore.getState().openDialog({ type: 'loadError', fileName, error: result.error });
  return null;
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const opened = await projectRepository().open();
    if (!opened) return;
    const doc = showLoadError(opened.file.name, opened.text);
    if (!doc) return;
    await replaceProject(doc, opened.file);
    await projectRepository()
      .recordRecent(opened.file, { projectId: doc.id, projectName: doc.name }, opened.text)
      .catch(() => undefined);
    toast.success(t('project.opened', { name: doc.name }));
  } catch (error) {
    toast.error(t('project.readError'), {
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}

export async function openRecent(entry: RecentEntry): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const opened = await projectRepository().openRecent(entry);
    if (!opened) return;
    const doc = showLoadError(opened.file.name, opened.text);
    if (!doc) return;
    await replaceProject(doc, opened.file);
    await projectRepository()
      .recordRecent(opened.file, { projectId: doc.id, projectName: doc.name }, opened.text)
      .catch(() => undefined);
  } catch (error) {
    toast.error(t('project.readError'), {
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}

/** Experimental StarUML import: translate, then let the user review the report before opening. */
export async function importStarUml(): Promise<void> {
  try {
    const picked = await projectRepository().importFile({
      name: 'StarUML model',
      extensions: ['mdj'],
      mime: 'application/json',
    });
    if (!picked) return;
    const result = importMdj(picked.text, { ids: uuidGenerator, now: new Date(), fileName: picked.name });
    useEditorStore.getState().openDialog({ type: 'mdjImport', fileName: picked.name, result });
  } catch (error) {
    toast.error(t('project.readError'), {
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}

/** Open an imported project as a new, unsaved project (it has no file yet). */
export async function openImportedProject(doc: ProjectDocument): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  await replaceProject(doc, null, { dirty: true });
  toast.success(t('mdj.opened', { name: doc.name }));
}

/** Persist per-diagram viewports into the document (bookkeeping, not an undoable edit). */
function persistViewports(): void {
  const doc = currentDoc();
  if (!doc) return;
  const { viewports } = useEditorStore.getState();
  const commands: Command[] = [];
  for (const [diagramId, viewport] of Object.entries(viewports)) {
    const diagram = doc.diagrams[diagramId];
    if (!diagram) continue;
    const v = diagram.viewport;
    if (v && v.x === viewport.x && v.y === viewport.y && v.zoom === viewport.zoom) continue;
    commands.push({ type: 'diagram/setViewport', diagramId, viewport });
  }
  if (commands.length) useDocumentStore.getState().dispatch(commands, { label: 'viewport', history: false });
}

async function saveWith(mode: 'save' | 'saveAs'): Promise<boolean> {
  const state = useDocumentStore.getState();
  if (!state.doc) return false;
  persistViewports();
  const doc = useDocumentStore.getState().doc!;
  const text = serializeProject({ ...doc, updatedAt: new Date().toISOString() });
  const repo = projectRepository();
  try {
    const file =
      mode === 'save'
        ? await repo.save(text, state.file, doc.name)
        : await repo.saveAs(text, state.file?.name ?? doc.name);
    if (!file) return false;
    useDocumentStore.getState().markSaved(file);
    await repo.recordRecent(file, { projectId: doc.id, projectName: doc.name }, text).catch(() => undefined);
    await recoveryRepository()
      .deleteRecovery(doc.id)
      .catch(() => undefined);
    useEditorStore.getState().setLastRecoveryAt(null);
    if (file.kind === 'download') toast.info(t('project.savedDownload', { name: file.name }));
    else toast.success(t('project.saved', { name: file.name }));
    return true;
  } catch (error) {
    toast.error(t('project.saveError'), {
      details: [error instanceof Error ? error.message : String(error)],
    });
    return false;
  }
}

export const saveProject = () => saveWith('save');
export const saveProjectAs = () => saveWith('saveAs');

export async function closeProject(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  const doc = currentDoc();
  if (doc)
    await recoveryRepository()
      .deleteRecovery(doc.id)
      .catch(() => undefined);
  useDocumentStore.getState().close();
  useEditorStore.getState().reset();
}

export async function restoreRecovery(projectId: ID): Promise<void> {
  const snapshot = await recoveryRepository().getRecovery(projectId);
  if (!snapshot) return;
  const doc = showLoadError(snapshot.projectName, snapshot.text);
  if (!doc) return;
  await replaceProject(doc, snapshot.file, { dirty: true });
  toast.info(t('recovery.restored', { name: doc.name }));
}

export async function discardRecovery(projectId: ID): Promise<void> {
  await recoveryRepository().deleteRecovery(projectId);
}

// -------------------------------------------------------------------------------------------------
// Diagrams
// -------------------------------------------------------------------------------------------------

export function createDiagram(kind: DiagramKind, name: string, ownerId?: ID): ID | null {
  const doc = currentDoc();
  if (!doc) return null;
  const created = createDiagramCommands(doc, {
    kind,
    name,
    ownerId: ownerId ?? doc.rootModelId,
    behaviorName: name,
    ids: uuidGenerator,
  });
  if (!created.ok || !created.diagramId) {
    toast.error(t('commandError.invalidPayload'));
    return null;
  }
  if (!run(created.commands, { label: t('history.addDiagram') })) return null;
  useEditorStore.getState().openDiagram(created.diagramId);
  return created.diagramId;
}

export function deleteDiagram(diagramId: ID): void {
  if (run({ type: 'diagram/delete', diagramId }, { label: t('history.deleteDiagram') })) {
    useEditorStore.getState().closeTab(diagramId);
  }
}

export function renameDiagram(diagramId: ID, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  run({ type: 'diagram/rename', diagramId, name: trimmed }, { label: t('history.rename') });
}

// -------------------------------------------------------------------------------------------------
// Edit
// -------------------------------------------------------------------------------------------------

export function undo(): void {
  if (useEditorStore.getState().editing) return;
  const entry = useDocumentStore.getState().undo();
  if (!entry) {
    toast.info(t('history.nothingToUndo'));
    return;
  }
  syncEditorWithDocument();
}

export function redo(): void {
  if (useEditorStore.getState().editing) return;
  const entry = useDocumentStore.getState().redo();
  if (!entry) {
    toast.info(t('history.nothingToRedo'));
    return;
  }
  syncEditorWithDocument();
}

export function selectedViewIds(): ID[] {
  return activeSelection(useEditorStore.getState());
}

export function copySelectionToClipboard(): boolean {
  const doc = currentDoc();
  const diagramId = useEditorStore.getState().activeDiagramId;
  if (!doc || !diagramId) return false;
  const payload = copySelection(doc, diagramId, selectedViewIds());
  if (!payload) return false;
  useEditorStore.getState().setClipboard(payload);
  try {
    void navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => undefined);
  } catch {
    // The in-memory clipboard is authoritative; the system clipboard is best effort.
  }
  toast.info(t('canvas.copied', { count: payload.views.length }));
  return true;
}

let pasteCount = 0;

export function pasteClipboard(): void {
  const doc = currentDoc();
  const editor = useEditorStore.getState();
  const diagramId = editor.activeDiagramId;
  const payload = editor.clipboard;
  if (!doc || !diagramId) return;
  if (!payload) {
    toast.info(t('canvas.nothingToPaste'));
    return;
  }
  pasteCount += 1;
  const offset = payload.sourceDiagramId === diagramId ? 24 * Math.min(pasteCount, 10) : 0;
  const result = pasteCommands(doc, {
    diagramId,
    payload,
    offset: { x: offset, y: offset },
    ids: uuidGenerator,
  });
  if (!result.ok) {
    toast.warning(t('canvas.pasteSkipped', { count: payload.elements.length }));
    return;
  }
  if (run(result.commands, { label: t('history.paste') })) {
    editor.setSelection(diagramId, result.createdViewIds);
    toast.success(t('canvas.pasted', { count: result.createdViewIds.length }));
    if (result.skipped) toast.warning(t('canvas.pasteSkipped', { count: result.skipped }));
  }
}

export function duplicateSelection(): void {
  const doc = currentDoc();
  const editor = useEditorStore.getState();
  const diagramId = editor.activeDiagramId;
  if (!doc || !diagramId) return;
  const payload = copySelection(doc, diagramId, selectedViewIds());
  if (!payload) return;
  const result = pasteCommands(doc, { diagramId, payload, offset: { x: 30, y: 30 }, ids: uuidGenerator });
  if (result.ok && run(result.commands, { label: t('history.duplicate') }))
    editor.setSelection(diagramId, result.createdViewIds);
}

/** Semantic elements whose deletion would be implied by deleting the selected views. */
function selectedElementIds(): ID[] {
  const doc = currentDoc();
  const diagramId = useEditorStore.getState().activeDiagramId;
  if (!doc || !diagramId) return [];
  const diagram = doc.diagrams[diagramId];
  if (!diagram) return [];
  const ids = new Set<ID>();
  for (const viewId of selectedViewIds()) {
    const view = diagram.views[viewId];
    if (view && 'elementId' in view) ids.add(view.elementId);
  }
  return [...ids];
}

/** Delete / Backspace on the canvas: remove views (spec §4.3 policy, see docs). */
export function removeSelectionFromDiagram(): void {
  const doc = currentDoc();
  const editor = useEditorStore.getState();
  const diagramId = editor.activeDiagramId;
  if (!doc || !diagramId) return;
  const viewIds = selectedViewIds();
  if (!viewIds.length) return;
  const diagram = doc.diagrams[diagramId]!;
  // Lifelines carry semantic messages: confirm through the delete-from-model dialog.
  const lifelineIds = viewIds.flatMap((id) => {
    const v = diagram.views[id];
    return v?.kind === 'lifeline' ? [v.elementId] : [];
  });
  if (lifelineIds.length) {
    const attached = Object.values(doc.modelElements).filter(
      (e) =>
        e.kind === 'message' &&
        ((e.sourceLifelineId && lifelineIds.includes(e.sourceLifelineId)) ||
          (e.targetLifelineId && lifelineIds.includes(e.targetLifelineId))),
    );
    if (attached.length) {
      editor.openDialog({
        type: 'deleteFromModel',
        elementIds: selectedElementIds(),
        context: { diagramId, viewIds },
      });
      return;
    }
  }
  const soleClassifier = viewIds.length === 1 ? diagram.views[viewIds[0]!] : undefined;
  if (
    run(
      { type: 'view/remove', diagramId, viewIds, deleteScopedOrphans: true },
      { label: t('history.remove') },
    )
  ) {
    editor.setSelection(diagramId, []);
    if (soleClassifier?.kind === 'node') {
      const el = useDocumentStore.getState().doc?.modelElements[soleClassifier.elementId];
      if (el && !isRelationship(el) && viewsOfElement(useDocumentStore.getState().doc!, el.id).length === 0) {
        toast.info(t('canvas.removedKeepModel', { name: el.name || t('common.unnamed') }), {
          action: { label: t('deleteDialog.deleteFromModel'), run: () => requestDeleteFromModel([el.id]) },
        });
      }
    }
  }
}

export function requestDeleteFromModel(elementIds?: ID[]): void {
  const ids = elementIds ?? selectedElementIds();
  const editor = useEditorStore.getState();
  const fromExplorer = !elementIds && editor.inspectorSource === 'explorer' && editor.explorerSelection;
  const finalIds = fromExplorer ? [editor.explorerSelection!] : ids;
  const doc = currentDoc();
  if (!doc || finalIds.length === 0) return;
  if (finalIds.length === 1 && doc.diagrams[finalIds[0]!]) {
    editor.openDialog({ type: 'deleteDiagram', diagramId: finalIds[0]! });
    return;
  }
  const valid = finalIds.filter((id) => doc.modelElements[id] && id !== doc.rootModelId);
  if (!valid.length) return;
  editor.openDialog({ type: 'deleteFromModel', elementIds: valid });
}

export function deleteFromModel(elementIds: ID[]): void {
  if (run({ type: 'element/delete', elementIds }, { label: t('history.delete') })) {
    toast.success(t('deleteDialog.deleted', { count: elementIds.length }));
  }
}

export function selectAll(): void {
  const doc = currentDoc();
  const diagramId = useEditorStore.getState().activeDiagramId;
  if (!doc || !diagramId) return;
  const diagram = doc.diagrams[diagramId];
  if (!diagram) return;
  useEditorStore.getState().setSelection(diagramId, Object.keys(diagram.views));
}

export function renameSelection(): void {
  const editor = useEditorStore.getState();
  const diagramId = editor.activeDiagramId;
  const ids = selectedViewIds();
  if (!diagramId || ids.length !== 1) return;
  const doc = currentDoc();
  const view = doc?.diagrams[diagramId]?.views[ids[0]!];
  if (!view) return;
  if (view.kind === 'edge')
    editor.setEditing({ diagramId, viewId: view.id, target: { type: 'label', key: 'name' } });
  else if (view.kind === 'message')
    editor.setEditing({ diagramId, viewId: view.id, target: { type: 'label', key: 'name' } });
  else editor.setEditing({ diagramId, viewId: view.id, target: { type: 'name' } });
}

// -------------------------------------------------------------------------------------------------
// Model
// -------------------------------------------------------------------------------------------------

/** Element the "add member" commands apply to: the single selected classifier. */
export function selectedClassifierId(): ID | null {
  const doc = currentDoc();
  const editor = useEditorStore.getState();
  if (!doc) return null;
  const ids =
    editor.inspectorSource === 'explorer' && editor.explorerSelection
      ? [editor.explorerSelection]
      : selectedElementIds();
  if (ids.length !== 1) return null;
  const el = doc.modelElements[ids[0]!];
  return el && hasFeatures(el) ? el.id : null;
}

export function addMember(
  collection: 'attributes' | 'operations' | 'literals',
  elementId = selectedClassifierId(),
): ID | null {
  const doc = currentDoc();
  if (!doc || !elementId) return null;
  const el = doc.modelElements[elementId];
  if (!el || !hasFeatures(el)) return null;
  const id = uuidGenerator.next();
  const settings = doc.settings;
  const existing =
    collection === 'attributes'
      ? el.attributes
      : collection === 'operations'
        ? el.operations
        : el.kind === 'enumeration'
          ? el.literals
          : [];
  const base =
    collection === 'attributes'
      ? t('defaultName.attribute')
      : collection === 'operations'
        ? t('defaultName.operation')
        : t('defaultName.literal');
  const used = new Set(existing.map((m) => m.name));
  let name = base;
  for (let n = 1; used.has(name); n += 1) name = `${base}${n}`;
  const member =
    collection === 'attributes'
      ? makeAttribute({ id, name, type: 'String', visibility: settings.defaultAttributeVisibility })
      : collection === 'operations'
        ? makeOperation({ id, name, returnType: 'void', visibility: settings.defaultOperationVisibility })
        : makeLiteral({ id, name });
  if (collection === 'literals' && el.kind !== 'enumeration') return null;
  if (!run({ type: 'member/add', elementId, collection, member }, { label: t('history.add', { name }) }))
    return null;
  // Start inline editing of the new member in the active diagram, if it is shown there.
  const editor = useEditorStore.getState();
  const diagramId = editor.activeDiagramId;
  const view = diagramId
    ? Object.values(currentDoc()!.diagrams[diagramId]?.views ?? {}).find(
        (v) => v.kind === 'node' && v.elementId === elementId,
      )
    : undefined;
  if (diagramId && view)
    editor.setEditing({ diagramId, viewId: view.id, target: { type: 'member', collection, memberId: id } });
  return id;
}

export function validateNow(): void {
  const doc = currentDoc();
  if (!doc) return;
  const issues = validateProject(doc);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  useEditorStore.getState().setBottomTab('problems');
  (errors ? toast.warning : toast.success)(t('problems.validated', { errors, warnings }));
}

/** Open the diagram that shows an element and select its view (problems, search, explorer). */
export function revealElement(elementId: ID, preferredDiagramId?: ID): boolean {
  const doc = currentDoc();
  if (!doc) return false;
  const editor = useEditorStore.getState();
  const locations = viewsOfElement(doc, elementId);
  const location =
    locations.find((l) => l.diagramId === preferredDiagramId) ??
    locations.find((l) => l.diagramId === editor.activeDiagramId) ??
    locations[0];
  editor.selectInExplorer(elementId);
  if (!location) return false;
  editor.openDiagram(location.diagramId);
  editor.setSelection(location.diagramId, [location.view.id]);
  editor.requestFocus(location.diagramId, [location.view.id]);
  return true;
}

// -------------------------------------------------------------------------------------------------
// Arrange
// -------------------------------------------------------------------------------------------------

export type AlignMode =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeH' | 'distributeV';

export function alignSelection(mode: AlignMode): void {
  const doc = currentDoc();
  const diagramId = useEditorStore.getState().activeDiagramId;
  if (!doc || !diagramId) return;
  const diagram = doc.diagrams[diagramId]!;
  if (DIAGRAM_KIND_INFO[diagram.kind].renderMode !== 'graph') return;
  const layout = layoutGraphDiagram(doc, diagram, PRINT_THEME);
  const boxes = selectedViewIds()
    .map((id) => layout.nodeById.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n && isBoxView(n.view));
  if (boxes.length < 2) return;
  const rect = (n: (typeof boxes)[number]) => ({ x: n.x, y: n.y, w: n.layout.width, h: n.layout.height });
  const rects = boxes.map(rect);
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const patches: Record<ID, { x?: number; y?: number }> = {};
  boxes.forEach((n, i) => {
    const r = rects[i]!;
    switch (mode) {
      case 'left':
        patches[n.view.id] = { x: minX };
        break;
      case 'right':
        patches[n.view.id] = { x: maxX - r.w };
        break;
      case 'center':
        patches[n.view.id] = { x: Math.round((minX + maxX) / 2 - r.w / 2) };
        break;
      case 'top':
        patches[n.view.id] = { y: minY };
        break;
      case 'bottom':
        patches[n.view.id] = { y: maxY - r.h };
        break;
      case 'middle':
        patches[n.view.id] = { y: Math.round((minY + maxY) / 2 - r.h / 2) };
        break;
      default:
        break;
    }
  });
  if (mode === 'distributeH' || mode === 'distributeV') {
    const horizontal = mode === 'distributeH';
    const sorted = boxes
      .map((n, i) => ({ n, r: rects[i]! }))
      .sort((a, b) => (horizontal ? a.r.x - b.r.x : a.r.y - b.r.y));
    const total = sorted.reduce((s, e) => s + (horizontal ? e.r.w : e.r.h), 0);
    const span = horizontal ? maxX - minX : maxY - minY;
    const gap = (span - total) / (sorted.length - 1);
    let cursor = horizontal ? minX : minY;
    for (const e of sorted) {
      patches[e.n.view.id] = horizontal ? { x: Math.round(cursor) } : { y: Math.round(cursor) };
      cursor += (horizontal ? e.r.w : e.r.h) + gap;
    }
  }
  run({ type: 'view/updateMany', diagramId, patches }, { label: t('history.align') });
}

export function reorderSelection(position: 'front' | 'back'): void {
  const diagramId = useEditorStore.getState().activeDiagramId;
  const viewIds = selectedViewIds();
  if (!diagramId || !viewIds.length) return;
  run({ type: 'view/reorder', diagramId, viewIds, position }, { label: t('history.reorder') });
}

export function setRoutingForSelection(routing: 'straight' | 'orthogonal'): void {
  const doc = currentDoc();
  const diagramId = useEditorStore.getState().activeDiagramId;
  if (!doc || !diagramId) return;
  const diagram = doc.diagrams[diagramId]!;
  const edges = selectedViewIds().filter((id) => diagram.views[id]?.kind === 'edge');
  if (!edges.length) return;
  const patches = Object.fromEntries(edges.map((id) => [id, { routing, waypoints: [] }]));
  run({ type: 'view/updateMany', diagramId, patches }, { label: t('history.route') });
}

// -------------------------------------------------------------------------------------------------
// View
// -------------------------------------------------------------------------------------------------

export const zoomIn = () => canvasApi.current?.zoomIn();
export const zoomOut = () => canvasApi.current?.zoomOut();
export const resetZoom = () => canvasApi.current?.resetZoom();
export const fitDiagram = () => canvasApi.current?.fit();

export function toggleTheme(theme: 'system' | 'light' | 'dark'): void {
  useSettingsStore.getState().update({ theme });
}
