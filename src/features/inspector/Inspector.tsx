import { useState } from 'react';
import { Tabs } from 'radix-ui';
import { run } from '@/app/actions';
import type { ID } from '@/domain/schemas/common';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { ElementProperties } from './ElementProperties';
import { AreaField, CheckField, MultiplicityDatalist, Section, SelectField, TextField } from './fields';
import { TypeDatalist } from './MemberEditors';
import { StyleProperties } from './StyleProperties';

/** Stable empty selection (Zustand selectors must not return fresh arrays). */
const NO_SELECTION: string[] = [];

type Target =
  | { type: 'none' }
  | { type: 'project' }
  | { type: 'diagram'; diagram: UMLDiagram }
  | { type: 'element'; elementId: ID; diagramId?: ID; viewIds: ID[] }
  | { type: 'note'; diagramId: ID; viewId: ID }
  | { type: 'multi'; diagramId: ID; viewIds: ID[] };

function resolveTarget(
  doc: ProjectDocument | null,
  source: 'canvas' | 'explorer',
  explorerSelection: ID | null,
  activeDiagramId: ID | null,
  selection: ID[],
): Target {
  if (!doc) return { type: 'none' };
  if (source === 'explorer' && explorerSelection) {
    if (doc.diagrams[explorerSelection])
      return { type: 'diagram', diagram: doc.diagrams[explorerSelection]! };
    if (doc.modelElements[explorerSelection]) {
      if (explorerSelection === doc.rootModelId) return { type: 'project' };
      return { type: 'element', elementId: explorerSelection, viewIds: [] };
    }
  }
  const diagram = activeDiagramId ? doc.diagrams[activeDiagramId] : undefined;
  if (!diagram) return { type: 'project' };
  const views = selection.map((id) => diagram.views[id]).filter((v) => !!v);
  if (views.length === 0) return { type: 'diagram', diagram };
  if (views.length > 1) return { type: 'multi', diagramId: diagram.id, viewIds: views.map((v) => v.id) };
  const view = views[0]!;
  if (view.kind === 'note' || view.kind === 'noteLink')
    return { type: 'note', diagramId: diagram.id, viewId: view.id };
  return { type: 'element', elementId: view.elementId, diagramId: diagram.id, viewIds: [view.id] };
}

export function Inspector() {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc);
  const source = useEditorStore((s) => s.inspectorSource);
  const explorerSelection = useEditorStore((s) => s.explorerSelection);
  const activeDiagramId = useEditorStore((s) => s.activeDiagramId);
  const selection = useEditorStore((s) =>
    s.activeDiagramId ? (s.selections[s.activeDiagramId] ?? NO_SELECTION) : NO_SELECTION,
  );
  const [tab, setTab] = useState('properties');
  const target = resolveTarget(doc, source, explorerSelection, activeDiagramId, selection);

  const element = target.type === 'element' ? doc?.modelElements[target.elementId] : undefined;
  const hasStyle =
    (target.type === 'element' && target.viewIds.length > 0) ||
    target.type === 'note' ||
    target.type === 'multi';
  const hasDocs = target.type === 'element' || target.type === 'diagram' || target.type === 'project';
  const activeTab =
    tab === 'style' && !hasStyle ? 'properties' : tab === 'documentation' && !hasDocs ? 'properties' : tab;

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-surface-1"
      aria-label={t('inspector.title')}
      data-testid="inspector"
    >
      <MultiplicityDatalist />
      <TypeDatalist />
      <Tabs.Root value={activeTab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex h-8 shrink-0 items-end gap-1 border-b border-border px-2">
          {(['properties', 'style', 'documentation'] as const).map((value) => (
            <Tabs.Trigger
              key={value}
              value={value}
              disabled={(value === 'style' && !hasStyle) || (value === 'documentation' && !hasDocs)}
              className={cn(
                'h-7 rounded-t px-2.5 text-[12px] text-muted outline-none hover:text-fg disabled:opacity-35',
                'data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-fg',
              )}
              data-testid={`inspector-tab-${value}`}
            >
              {t(`inspector.${value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          key={`${target.type}:${'elementId' in target ? target.elementId : ''}:${'viewId' in target ? target.viewId : ''}`}
        >
          <Tabs.Content value="properties" className="outline-none">
            {target.type === 'none' && (
              <p className="p-3 text-[12px] text-faint">{t('inspector.nothingSelected')}</p>
            )}
            {target.type === 'project' && doc && <ProjectProperties doc={doc} />}
            {target.type === 'diagram' && <DiagramProperties diagram={target.diagram} />}
            {target.type === 'element' && element && <ElementProperties element={element} />}
            {target.type === 'note' && <NoteProperties diagramId={target.diagramId} viewId={target.viewId} />}
            {target.type === 'multi' && (
              <p className="p-3 text-[12px] text-muted">
                {t('inspector.multipleSelected', { count: target.viewIds.length })}
              </p>
            )}
          </Tabs.Content>
          <Tabs.Content value="style" className="outline-none">
            {target.type === 'element' && target.diagramId && (
              <StyleProperties diagramId={target.diagramId} viewIds={target.viewIds} />
            )}
            {target.type === 'note' && (
              <StyleProperties diagramId={target.diagramId} viewIds={[target.viewId]} />
            )}
            {target.type === 'multi' && (
              <StyleProperties diagramId={target.diagramId} viewIds={target.viewIds} />
            )}
          </Tabs.Content>
          <Tabs.Content value="documentation" className="p-3 outline-none">
            {target.type === 'element' && element && (
              <AreaField
                label={t('inspector.documentation')}
                value={element.documentation}
                rows={12}
                placeholder={t('inspector.documentationPlaceholder')}
                testId="prop-documentation"
                onCommit={(v) =>
                  run(
                    { type: 'element/update', elementId: element.id, patch: { documentation: v } },
                    { label: t('history.edit', { field: t('inspector.documentation') }) },
                  )
                }
              />
            )}
            {target.type === 'diagram' && (
              <AreaField
                label={t('inspector.documentation')}
                value={target.diagram.documentation}
                rows={12}
                onCommit={(v) =>
                  run(
                    { type: 'diagram/update', diagramId: target.diagram.id, documentation: v },
                    { label: t('history.edit', { field: t('inspector.documentation') }) },
                  )
                }
              />
            )}
            {target.type === 'project' && doc && (
              <AreaField
                label={t('project.descriptionLabel')}
                value={doc.description}
                rows={12}
                onCommit={(v) =>
                  run(
                    { type: 'project/update', description: v },
                    { label: t('history.edit', { field: t('project.descriptionLabel') }) },
                  )
                }
              />
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </aside>
  );
}

function ProjectProperties({ doc }: { doc: ProjectDocument }) {
  const t = useT();
  const root = doc.modelElements[doc.rootModelId];
  const vis = (['public', 'private', 'protected', 'package'] as const).map((v) => ({
    value: v,
    label: t(`visibility.${v}`),
  }));
  return (
    <>
      <Section title={t('project.properties')}>
        <TextField
          label={t('project.nameLabel')}
          value={doc.name}
          onCommit={(v) =>
            v.trim() && run({ type: 'project/rename', name: v.trim() }, { label: t('history.rename') })
          }
          testId="project-name"
        />
        {root && (
          <TextField
            label={t('elementKind.model')}
            value={root.name}
            onCommit={(v) =>
              run(
                { type: 'element/update', elementId: root.id, patch: { name: v.trim() } },
                { label: t('history.rename') },
              )
            }
          />
        )}
        <div className="text-[12px] text-faint">
          {t('project.elements', { count: Object.keys(doc.modelElements).length - 1 })}
        </div>
      </Section>
      <Section title={t('settings.modeling')}>
        <SelectField
          label={t('settings.defaultAttributeVisibility')}
          value={doc.settings.defaultAttributeVisibility}
          options={vis}
          onChange={(v) =>
            run(
              { type: 'project/update', settings: { defaultAttributeVisibility: v } },
              { label: t('history.edit', { field: t('inspector.visibility') }) },
            )
          }
        />
        <SelectField
          label={t('settings.defaultOperationVisibility')}
          value={doc.settings.defaultOperationVisibility}
          options={vis}
          onChange={(v) =>
            run(
              { type: 'project/update', settings: { defaultOperationVisibility: v } },
              { label: t('history.edit', { field: t('inspector.visibility') }) },
            )
          }
        />
      </Section>
    </>
  );
}

function DiagramProperties({ diagram }: { diagram: UMLDiagram }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const o = diagram.options;
  const set = (options: Partial<typeof o>) =>
    run(
      { type: 'diagram/update', diagramId: diagram.id, options },
      { label: t('history.edit', { field: t('inspector.diagramOptions') }) },
    );
  const owner = doc.modelElements[diagram.ownerId];
  const isSequence = diagram.kind === 'sequence';
  return (
    <>
      <Section>
        <TextField
          label={t('diagram.nameLabel')}
          value={diagram.name}
          onCommit={(v) =>
            v.trim() &&
            run(
              { type: 'diagram/rename', diagramId: diagram.id, name: v.trim() },
              { label: t('history.rename') },
            )
          }
          testId="diagram-name"
        />
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {t('common.kind')}
            </span>
            <span>{t(`diagramKind.${diagram.kind}`)}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {t('diagram.ownerLabel')}
            </span>
            <span className="truncate">{owner?.name}</span>
          </div>
        </div>
        <div className="text-[12px] text-faint">
          {t('project.elements', { count: Object.keys(diagram.views).length })}
        </div>
      </Section>
      <Section title={t('inspector.diagramOptions')}>
        {!isSequence && (
          <>
            <CheckField
              label={t('inspector.showVisibility')}
              checked={o.showVisibility}
              onChange={(v) => set({ showVisibility: v })}
            />
            <CheckField
              label={t('inspector.showAttributeTypes')}
              checked={o.showAttributeTypes}
              onChange={(v) => set({ showAttributeTypes: v })}
            />
            <CheckField
              label={t('inspector.showSignatures')}
              checked={o.showOperationSignatures}
              onChange={(v) => set({ showOperationSignatures: v })}
            />
            <SelectField
              label={t('inspector.defaultRouting')}
              value={o.defaultRouting}
              options={[
                { value: 'straight', label: t('cmd.routingStraight') },
                { value: 'orthogonal', label: t('cmd.routingOrthogonal') },
              ]}
              onChange={(v) => set({ defaultRouting: v })}
            />
          </>
        )}
        {isSequence && (
          <CheckField
            label={t('inspector.showMessageNumbers')}
            checked={o.showMessageNumbers}
            onChange={(v) => set({ showMessageNumbers: v })}
            testId="opt-message-numbers"
          />
        )}
      </Section>
    </>
  );
}

function NoteProperties({ diagramId, viewId }: { diagramId: ID; viewId: ID }) {
  const t = useT();
  const view = useDocumentStore((s) => s.doc?.diagrams[diagramId]?.views[viewId]);
  if (view?.kind !== 'note')
    return <p className="p-3 text-[12px] text-faint">{t('inspector.noteSelected')}</p>;
  return (
    <Section title={t('inspector.noteSelected')}>
      <AreaField
        label={t('inspector.noteText')}
        value={view.text}
        onCommit={(text) =>
          run(
            { type: 'view/update', diagramId, viewId, patch: { text } },
            { label: t('history.edit', { field: t('inspector.noteText') }) },
          )
        }
      />
    </Section>
  );
}
