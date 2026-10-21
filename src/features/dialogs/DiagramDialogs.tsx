import { useMemo, useState } from 'react';
import { createDiagram, deleteDiagram, deleteFromModel, renameDiagram, run } from '@/app/actions';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { PACKAGE_LIKE, DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import type { ID } from '@/domain/schemas/common';
import { isRelationship } from '@/domain/schemas/elements';
import type { DiagramKind } from '@/domain/schemas/project';
import { planElementDeletion } from '@/domain/services/deletion';
import { qualifiedName } from '@/domain/services/queries';
import { CATALOG_ORDER, DIAGRAM_CATALOG } from '@/diagrams/registry/catalog';
import { glyphForDiagram, UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

const close = () => useEditorStore.getState().closeDialog();

export function NewDiagramDialog({ ownerId, kind: initialKind }: { ownerId?: ID; kind?: DiagramKind }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const [kind, setKind] = useState<DiagramKind>(initialKind ?? 'class');
  const [name, setName] = useState('');
  const owners = useMemo(
    () =>
      Object.values(doc.modelElements)
        .filter(
          (e) =>
            PACKAGE_LIKE.includes(e.kind) ||
            e.kind === 'interaction' ||
            e.kind === 'activity' ||
            e.kind === 'stateMachine',
        )
        .map((e) => ({ id: e.id, label: qualifiedName(doc, e.id) || e.name, kind: e.kind })),
    [doc],
  );
  const preferredOwner = ownerId && owners.some((o) => o.id === ownerId) ? ownerId : doc.rootModelId;
  const [owner, setOwner] = useState(preferredOwner);
  const entry = DIAGRAM_CATALOG[kind];
  const ownerKind = doc.modelElements[owner]?.kind;
  const info = DIAGRAM_KIND_INFO[kind];
  const ownerOk = !!ownerKind && (info.ownerKinds.includes(ownerKind) || PACKAGE_LIKE.includes(ownerKind));
  const canCreate = entry.status !== 'planned' && ownerOk;
  const create = (chosen: DiagramKind = kind) => {
    if (DIAGRAM_CATALOG[chosen].status === 'planned' || !ownerOk) return;
    close();
    createDiagram(chosen, name.trim() || t(`diagramKind.${chosen}`), owner);
  };
  const groups = (['structural', 'behavioral', 'interaction'] as const).map((category) => ({
    category,
    kinds: CATALOG_ORDER.filter((k) => DIAGRAM_CATALOG[k].category === category),
  }));
  return (
    <Modal
      open
      onClose={close}
      title={t('diagram.newTitle')}
      width="lg"
      testId="new-diagram-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canCreate}
            onClick={() => create()}
            data-testid="create-diagram"
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_220px] gap-4">
        <div className="flex flex-col gap-3" role="listbox" aria-label={t('diagram.newTitle')}>
          {groups.map((g) => (
            <div key={g.category}>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
                {t(`diagram.categories.${g.category}`)}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {g.kinds.map((k) => {
                  const e = DIAGRAM_CATALOG[k];
                  const planned = e.status === 'planned';
                  return (
                    <button
                      key={k}
                      type="button"
                      role="option"
                      aria-selected={kind === k}
                      aria-disabled={planned}
                      data-testid={`diagram-kind-${k}`}
                      onClick={() => setKind(k)}
                      onDoubleClick={() => !planned && create(k)}
                      title={t(`diagram.statusHint.${e.status}`)}
                      className={cn(
                        'flex items-start gap-2 rounded-md border p-2 text-left',
                        kind === k
                          ? 'border-accent bg-accent-muted'
                          : 'border-border bg-surface-2 hover:border-border-strong',
                        planned && 'opacity-55',
                      )}
                    >
                      <UmlGlyph name={glyphForDiagram(k)} size={18} className="mt-0.5 shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                          {t(`diagramKind.${k}`)}
                          <span
                            className={cn(
                              'rounded px-1 text-[9.5px] font-semibold uppercase',
                              e.status === 'complete'
                                ? 'bg-success-muted text-success'
                                : e.status === 'partial'
                                  ? 'bg-warning-muted text-warning'
                                  : 'bg-surface-4 text-faint',
                            )}
                          >
                            {t(`diagram.status.${e.status}`)}
                          </span>
                        </span>
                        <span className="block text-[11px] leading-snug text-muted">
                          {t(`diagramDescription.${k}`)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Field label={t('diagram.nameLabel')} htmlFor="diagram-name">
            <Input
              id="diagram-name"
              value={name}
              placeholder={t(`diagramKind.${kind}`)}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              data-testid="diagram-name-input"
            />
          </Field>
          <Field
            label={t('diagram.ownerLabel')}
            htmlFor="diagram-owner"
            error={ownerOk ? null : t('commandError.ownershipNotAllowed')}
          >
            <Select id="diagram-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} ({t(`elementKind.${o.kind}`)})
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[11.5px] text-muted">{t(`diagram.statusHint.${entry.status}`)}</p>
          {entry.status === 'planned' && <p className="text-[11.5px] text-warning">{t('canvas.planned')}</p>}
        </div>
      </div>
    </Modal>
  );
}

export function DeleteDiagramDialog({ diagramId }: { diagramId: ID }) {
  const t = useT();
  const diagram = useDocumentStore((s) => s.doc?.diagrams[diagramId]);
  if (!diagram) return null;
  return (
    <Modal
      open
      onClose={close}
      title={t('diagram.deleteTitle', { name: diagram.name })}
      width="sm"
      testId="delete-diagram-dialog"
      footer={
        <>
          <Button variant="ghost" autoFocus onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            data-testid="confirm-delete-diagram"
            onClick={() => {
              close();
              deleteDiagram(diagramId);
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-[13px]">{t('diagram.deleteBody', { count: Object.keys(diagram.views).length })}</p>
      <p className="mt-2 text-[12px] text-faint">{t('deleteDialog.undoHint')}</p>
    </Modal>
  );
}

export function RenameDiagramDialog({ diagramId }: { diagramId: ID }) {
  const t = useT();
  const diagram = useDocumentStore((s) => s.doc?.diagrams[diagramId]);
  const [name, setName] = useState(diagram?.name ?? '');
  if (!diagram) return null;
  const commit = () => {
    close();
    renameDiagram(diagramId, name);
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('cmd.renameDiagram')}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={commit} disabled={!name.trim()}>
            {t('common.rename')}
          </Button>
        </>
      }
    >
      <Field label={t('diagram.renamePrompt')} htmlFor="rename-diagram">
        <Input
          id="rename-diagram"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </Field>
    </Modal>
  );
}

/** Confirmation for semantic deletion, listing everything affected (spec §21.1). */
export function DeleteFromModelDialog({
  elementIds,
  context,
}: {
  elementIds: ID[];
  context?: { diagramId: ID; viewIds: ID[] };
}) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const plan = useMemo(() => planElementDeletion(doc, elementIds), [doc, elementIds]);
  const viewCount = [...plan.viewsByDiagram.values()].reduce((n, s) => n + s.size, 0);
  const names = elementIds
    .map((id) => doc.modelElements[id])
    .filter((e) => !!e)
    .map((e) => e!.name || t(`elementKind.${e!.kind}`));
  const lifelineOnly = context && elementIds.every((id) => doc.modelElements[id]?.kind === 'lifeline');
  const canRemoveViewsOnly =
    !!context &&
    !lifelineOnly &&
    elementIds.some((id) => {
      const el = doc.modelElements[id];
      return el && !isRelationship(el);
    });
  return (
    <Modal
      open
      onClose={close}
      title={t('deleteDialog.title')}
      width="md"
      testId="delete-model-dialog"
      footer={
        <>
          <Button variant="ghost" autoFocus onClick={close}>
            {t('common.cancel')}
          </Button>
          {canRemoveViewsOnly && context && (
            <Button
              onClick={() => {
                close();
                run(
                  {
                    type: 'view/remove',
                    diagramId: context.diagramId,
                    viewIds: context.viewIds,
                    deleteScopedOrphans: false,
                  },
                  { label: t('history.remove') },
                );
              }}
              data-testid="remove-from-diagram"
            >
              {t('deleteDialog.removeFromDiagram')}
            </Button>
          )}
          <Button
            variant="danger"
            data-testid="confirm-delete-model"
            onClick={() => {
              close();
              deleteFromModel(elementIds);
            }}
          >
            {t('deleteDialog.deleteFromModel')}
          </Button>
        </>
      }
    >
      <p className="text-[13px]">{t('deleteDialog.body', { count: plan.elementIds.size })}</p>
      <p className="mt-1 truncate text-[12.5px] font-medium">{names.join(', ')}</p>
      {lifelineOnly && (
        <p className="mt-2 text-[12.5px] text-warning">
          {t('canvas.lifelineDeleteWarning', {
            count: [...plan.elementIds].filter((id) => doc.modelElements[id]?.kind === 'message').length,
          })}
        </p>
      )}
      <p className="mt-2 text-[12.5px] text-muted" data-testid="delete-impact">
        {t('deleteDialog.affects', {
          diagrams: plan.viewsByDiagram.size,
          views: viewCount,
          relationships: plan.relationshipIds.size,
        })}
      </p>
      {plan.diagramIds.size > 0 && (
        <p className="mt-1 text-[12.5px] text-warning">
          {t('deleteDialog.ownedDiagrams', { count: plan.diagramIds.size })}
        </p>
      )}
      <p className="mt-2 text-[12px] text-faint">{t('deleteDialog.undoHint')}</p>
    </Modal>
  );
}
