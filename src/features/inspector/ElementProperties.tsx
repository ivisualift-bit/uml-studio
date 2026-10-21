import { ArrowLeftRight, Plus } from 'lucide-react';
import { revealElement, run } from '@/app/actions';
import { renameElementCommands } from '@/domain/commands/creators';
import type { FieldPatch } from '@/domain/commands/types';
import { uuidGenerator } from '@/domain/ids';
import { makeCommunicationMessage, makeExtensionPoint, makeOperand, makeSlot, makeTagDefinition } from '@/domain/model/factory';
import { formatTransitionLabel, parseGuard } from '@/domain/notation/labels';
import type { ID } from '@/domain/schemas/common';
import { hasFeatures, isRelationship, type ElementOf, type ModelElement, type RelationEnd, type Relationship } from '@/domain/schemas/elements';
import type { ProjectDocument } from '@/domain/schemas/project';
import { ancestorIds, viewsOfElement } from '@/domain/services/queries';
import { Button, IconButton } from '@/components/ui/controls';
import { useT, type MessageKey } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { CheckField, MultiplicityField, Row, Section, SelectField, TextField } from './fields';
import { FeatureEditors, NamedListEditor } from './MemberEditors';

const update = (elementId: ID, patch: FieldPatch, label: string) => run({ type: 'element/update', elementId, patch }, { label });

function useEdit(el: ModelElement) {
  const t = useT();
  return (field: string, patch: FieldPatch) => update(el.id, patch, t('history.edit', { field }));
}

function ownerPath(doc: ProjectDocument, el: ModelElement): string {
  return ancestorIds(doc, el.id)
    .reverse()
    .map((id) => doc.modelElements[id]?.name ?? '')
    .join(' :: ');
}

function UsedIn({ element }: { element: ModelElement }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const locations = viewsOfElement(doc, element.id);
  const diagrams = [...new Set(locations.map((l) => l.diagramId))].map((id) => doc.diagrams[id]).filter((d) => !!d);
  return (
    <div className="flex flex-col gap-1" data-testid="used-in">
      <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.usedIn')}</span>
      {diagrams.length === 0 ? (
        <span className="text-[12px] text-faint">{t('inspector.notShown')}</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {diagrams.map((d) => (
            <button key={d.id} type="button" className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-fg hover:border-accent" onClick={() => revealElement(element.id, d.id)}>
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Classifier select for semantic type references (lifeline type, instance classifier…). */
function ClassifierSelect({ label, value, onChange, kinds }: { label: string; value: ID | null; onChange: (id: ID | null) => void; kinds: readonly string[] }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const options = Object.values(doc.modelElements)
    .filter((e) => kinds.includes(e.kind) && e.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <SelectField
      label={label}
      value={value ?? ''}
      options={[{ value: '', label: `— ${t('common.none')} —` }, ...options.map((o) => ({ value: o.id, label: `${o.name} (${t(`elementKind.${o.kind}`)})` }))]}
      onChange={(v) => onChange(v || null)}
    />
  );
}

const TYPE_KINDS = ['class', 'interface', 'enumeration', 'dataType', 'primitiveType', 'signal', 'component', 'actor'] as const;

function EndEditor({ rel, which }: { rel: Extract<Relationship, { sourceEnd: RelationEnd }>; which: 'sourceEnd' | 'targetEnd' }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const end = rel[which];
  const endElement = doc.modelElements[which === 'sourceEnd' ? rel.sourceId : rel.targetId];
  const set = (patch: Partial<RelationEnd>) => update(rel.id, { [which]: { ...end, ...patch } }, t('history.edit', { field: t(which === 'sourceEnd' ? 'inspector.sourceEnd' : 'inspector.targetEnd') }));
  const isAssociation = rel.kind === 'association';
  return (
    <Section title={`${t(which === 'sourceEnd' ? 'inspector.sourceEnd' : 'inspector.targetEnd')} — ${endElement?.name ?? ''}`}>
      <Row>
        <TextField label={t('inspector.role')} value={end.name} onCommit={(v) => set({ name: v.trim() })} testId={`${which}-role`} />
        <MultiplicityField label={t('inspector.multiplicity')} value={end.multiplicity} onCommit={(v) => set({ multiplicity: v })} testId={`${which}-multiplicity`} />
      </Row>
      <Row>
        <SelectField
          label={t('inspector.navigability')}
          value={end.navigability}
          options={(['unspecified', 'navigable', 'nonNavigable'] as const).map((v) => ({ value: v, label: t(`navigability.${v}`) }))}
          onChange={(v) => set({ navigability: v })}
        />
        {isAssociation ? (
          <SelectField
            label={t('inspector.aggregation')}
            value={end.aggregation}
            options={(['none', 'shared', 'composite'] as const).map((v) => ({ value: v, label: t(`aggregation.${v}`) }))}
            onChange={(v) => set({ aggregation: v })}
            testId={`${which}-aggregation`}
          />
        ) : (
          <div />
        )}
      </Row>
      <div className="flex gap-3">
        <CheckField label={t('inspector.ordered')} checked={end.isOrdered} onChange={(v) => set({ isOrdered: v })} />
        <CheckField label={t('inspector.unique')} checked={end.isUnique} onChange={(v) => set({ isUnique: v })} />
      </div>
    </Section>
  );
}

function RelationshipProperties({ rel }: { rel: Relationship }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const edit = useEdit(rel);
  const source = doc.modelElements[rel.sourceId];
  const target = doc.modelElements[rel.targetId];
  const swap = () => run({ type: 'element/swapEnds', relationshipId: rel.id }, { label: t('inspector.swapEnds') });
  return (
    <>
      <Section>
        <TextField label={t('common.name')} value={rel.name} onCommit={(v) => edit(t('common.name'), { name: v.trim() })} testId="prop-name" />
        <Row>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.source')}</span>
            <button type="button" className="truncate text-left text-[12.5px] text-accent hover:underline" onClick={() => source && revealElement(source.id)}>
              {source?.name || t('common.unnamed')}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.target')}</span>
            <button type="button" className="truncate text-left text-[12.5px] text-accent hover:underline" onClick={() => target && revealElement(target.id)}>
              {target?.name || t('common.unnamed')}
            </button>
          </div>
        </Row>
        <TextField label={t('inspector.stereotype')} value={rel.stereotype} hint={t('inspector.stereotypeHint')} onCommit={(v) => edit(t('inspector.stereotype'), { stereotype: v.trim() })} />
        {rel.kind !== 'transition' && (
          <Button size="sm" variant="subtle" onClick={swap} className="self-start" data-testid="swap-ends">
            <ArrowLeftRight size={13} /> {t('inspector.swapEnds')}
          </Button>
        )}
        {rel.kind === 'association' && <CheckField label={t('inspector.derived')} checked={rel.isDerived} onChange={(v) => edit(t('inspector.derived'), { isDerived: v })} />}
      </Section>
      {(rel.kind === 'controlFlow' || rel.kind === 'objectFlow') && (
        <Section>
          <TextField label={t('inspector.guard')} value={rel.guard} placeholder="[condition]" onCommit={(v) => edit(t('inspector.guard'), { guard: parseGuard(v) })} testId="prop-guard" />
          <TextField label={t('inspector.weight')} value={rel.weight} onCommit={(v) => edit(t('inspector.weight'), { weight: v.trim() })} />
        </Section>
      )}
      {rel.kind === 'transition' && (
        <Section title={formatTransitionLabel(rel) || undefined}>
          <TextField label={t('inspector.trigger')} value={rel.trigger} onCommit={(v) => edit(t('inspector.trigger'), { trigger: v.trim() })} testId="prop-trigger" />
          <TextField label={t('inspector.guard')} value={rel.guard} onCommit={(v) => edit(t('inspector.guard'), { guard: parseGuard(v) })} testId="prop-guard" />
          <TextField label={t('inspector.effect')} value={rel.effect} onCommit={(v) => edit(t('inspector.effect'), { effect: v.trim() })} testId="prop-effect" />
          <SelectField label={t('common.kind')} value={rel.transitionKind} options={(['external', 'internal', 'local'] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => edit(t('common.kind'), { transitionKind: v })} />
        </Section>
      )}
      {rel.kind === 'extend' && <ExtendProperties rel={rel} />}
      {rel.kind === 'link' && (
        <Section>
          <SelectField
            label={t('inspector.association')}
            value={rel.associationId ?? ''}
            options={[
              { value: '', label: `— ${t('common.none')} —` },
              ...Object.values(doc.modelElements)
                .filter((e): e is ElementOf<'association'> => e.kind === 'association')
                .map((a) => ({ value: a.id, label: `${doc.modelElements[a.sourceId]?.name ?? '?'} — ${doc.modelElements[a.targetId]?.name ?? '?'}${a.name ? ` (${a.name})` : ''}` })),
            ]}
            onChange={(v) => edit(t('inspector.association'), { associationId: v || null })}
          />
        </Section>
      )}
      {rel.kind === 'connector' && <ConnectorProperties rel={rel} />}
      {rel.kind === 'extension' && (
        <Section>
          <CheckField label={t('inspector.required')} checked={rel.isRequired} onChange={(v) => edit(t('inspector.required'), { isRequired: v })} />
        </Section>
      )}
      {rel.kind === 'informationFlow' && <InformationFlowProperties rel={rel} />}
      {'sourceEnd' in rel && (
        <>
          <EndEditor rel={rel} which="sourceEnd" />
          <EndEditor rel={rel} which="targetEnd" />
        </>
      )}
    </>
  );
}

function ExtendProperties({ rel }: { rel: ElementOf<'extend'> }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const base = doc.modelElements[rel.targetId];
  const points = base?.kind === 'useCase' ? base.extensionPoints : [];
  const edit = useEdit(rel);
  return (
    <Section>
      <TextField label={t('inspector.condition')} value={rel.condition} onCommit={(v) => edit(t('inspector.condition'), { condition: v.trim() })} />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.extensionPoints')}</span>
        {points.length === 0 && <span className="text-[12px] text-faint">—</span>}
        {points.map((p) => (
          <CheckField
            key={p.id}
            label={p.name}
            checked={rel.extensionPointIds.includes(p.id)}
            onChange={(on) => edit(t('inspector.extensionPoints'), { extensionPointIds: on ? [...rel.extensionPointIds, p.id] : rel.extensionPointIds.filter((id) => id !== p.id) })}
          />
        ))}
      </div>
    </Section>
  );
}

function ConnectorProperties({ rel }: { rel: ElementOf<'connector'> }) {
  const t = useT();
  const edit = useEdit(rel);
  return (
    <>
      <Section>
        <SelectField
          label={t('inspector.connectorKind')}
          value={rel.connectorKind}
          options={(['basic', 'assembly', 'delegation'] as const).map((v) => ({ value: v, label: t(`connectorKind.${v}`) }))}
          onChange={(v) => edit(t('inspector.connectorKind'), { connectorKind: v })}
        />
      </Section>
      <Section
        title={t('toolbox.groups.messages')}
        actions={
          <IconButton
            label={t('inspector.addMessage')}
            className="h-6 w-6"
            data-testid="add-comm-message"
            onClick={() =>
              run(
                {
                  type: 'member/add',
                  elementId: rel.id,
                  collection: 'messages',
                  member: makeCommunicationMessage({ id: uuidGenerator.next(), sequence: String(rel.messages.length + 1), name: `${t('defaultName.message')}()` }),
                },
                { label: t('inspector.addMessage') },
              )
            }
          >
            <Plus size={14} />
          </IconButton>
        }
      >
        {rel.messages.map((m) => {
          const set = (patch: FieldPatch) => run({ type: 'member/update', elementId: rel.id, collection: 'messages', memberId: m.id, patch }, { label: t('history.edit', { field: m.name }) });
          return (
            <div key={m.id} className="flex items-center gap-1" data-testid="comm-message-row">
              <TextField compact label={t('inspector.sequence')} value={m.sequence} onCommit={(v) => set({ sequence: v.trim() })} className="w-12" />
              <TextField compact label={t('common.name')} value={m.name} onCommit={(v) => set({ name: v.trim() })} />
              <SelectField compact label={t('inspector.direction')} value={m.direction} options={[{ value: 'forward', label: '→' }, { value: 'backward', label: '←' }]} onChange={(v) => set({ direction: v })} />
              <SelectField
                compact
                label={t('inspector.messageSort')}
                value={m.sort}
                options={(['synchronous', 'asynchronous', 'reply'] as const).map((v) => ({ value: v, label: t(`messageSort.${v}`) }))}
                onChange={(v) => set({ sort: v })}
              />
              <IconButton label={t('common.delete')} className="h-6 w-6 shrink-0 hover:text-danger" onClick={() => run({ type: 'member/delete', elementId: rel.id, collection: 'messages', memberId: m.id }, { label: t('history.delete') })}>
                ×
              </IconButton>
            </div>
          );
        })}
      </Section>
    </>
  );
}

function InformationFlowProperties({ rel }: { rel: ElementOf<'informationFlow'> }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const edit = useEdit(rel);
  const candidates = Object.values(doc.modelElements).filter((e) => (e.kind === 'informationItem' || e.kind === 'class' || e.kind === 'signal' || e.kind === 'dataType') && e.name);
  return (
    <Section title={t('inspector.conveyed')}>
      {candidates.map((c) => (
        <CheckField
          key={c.id}
          label={`${c.name} (${t(`elementKind.${c.kind}`)})`}
          checked={rel.conveyedIds.includes(c.id)}
          onChange={(on) => edit(t('inspector.conveyed'), { conveyedIds: on ? [...rel.conveyedIds, c.id] : rel.conveyedIds.filter((id) => id !== c.id) })}
        />
      ))}
    </Section>
  );
}

function AppliedStereotypes({ element }: { element: ModelElement }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const stereotypes = Object.values(doc.modelElements).filter((e): e is ElementOf<'stereotype'> => e.kind === 'stereotype');
  if (!stereotypes.length && !element.appliedStereotypes.length) return null;
  const available = stereotypes.filter((s) => !element.appliedStereotypes.some((a) => a.stereotypeId === s.id));
  return (
    <Section title={t('inspector.appliedStereotypes')}>
      {element.appliedStereotypes.map((applied) => {
        const st = doc.modelElements[applied.stereotypeId];
        if (st?.kind !== 'stereotype') return null;
        return (
          <div key={applied.id} className="flex flex-col gap-1.5 rounded border border-border bg-surface-2 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium">«{st.name}»</span>
              <button type="button" className="text-[11px] text-faint hover:text-danger" onClick={() => run({ type: 'member/delete', elementId: element.id, collection: 'appliedStereotypes', memberId: applied.id }, { label: t('history.delete') })}>
                {t('common.remove')}
              </button>
            </div>
            {st.tagDefinitions.map((tag) => (
              <TextField
                key={tag.id}
                label={`${tag.name}: ${tag.type}`}
                value={applied.values[tag.name] ?? tag.defaultValue}
                onCommit={(v) => run({ type: 'member/update', elementId: element.id, collection: 'appliedStereotypes', memberId: applied.id, patch: { values: { ...applied.values, [tag.name]: v } } }, { label: t('history.edit', { field: tag.name }) })}
              />
            ))}
          </div>
        );
      })}
      {available.length > 0 && (
        <SelectField
          label={t('inspector.applyStereotype')}
          value=""
          options={[{ value: '', label: '—' }, ...available.map((s) => ({ value: s.id, label: `«${s.name}»` }))]}
          onChange={(id) => id && run({ type: 'member/add', elementId: element.id, collection: 'appliedStereotypes', member: { id: uuidGenerator.next(), stereotypeId: id, values: {} } }, { label: t('inspector.applyStereotype') })}
        />
      )}
    </Section>
  );
}

const PSEUDO_KINDS = ['initial', 'choice', 'junction', 'fork', 'join', 'shallowHistory', 'deepHistory', 'terminate', 'entryPoint', 'exitPoint'] as const;
const CONTROL_KINDS = ['initial', 'activityFinal', 'flowFinal', 'decision', 'merge', 'fork', 'join'] as const;
const ACTION_KINDS = ['opaque', 'callBehavior', 'sendSignal', 'acceptEvent', 'acceptTimeEvent'] as const;
const OPERATORS = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'assert', 'strict', 'seq', 'ignore', 'consider', 'ref'] as const;

export function ElementProperties({ element }: { element: ModelElement }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const edit = useEdit(element);
  if (isRelationship(element)) return <RelationshipProperties rel={element} />;
  const named = !['controlNode', 'pseudostate', 'finalState', 'activation', 'combinedFragment'].includes(element.kind) || element.kind === 'pseudostate';
  return (
    <>
      <Section>
        {named && (
          <TextField
            label={t('common.name')}
            value={element.name}
            testId="prop-name"
            onCommit={(v) => run(renameElementCommands(doc, element.id, v.trim()), { label: t('history.rename') })}
          />
        )}
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('common.kind')}</span>
            <span>{t(`elementKind.${element.kind}`)}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.owner')}</span>
            <span className="truncate" title={ownerPath(doc, element)}>
              {ownerPath(doc, element) || '—'}
            </span>
          </div>
        </div>
        {element.kind !== 'activation' && (
          <TextField label={t('inspector.stereotype')} value={element.stereotype} hint={t('inspector.stereotypeHint')} onCommit={(v) => edit(t('inspector.stereotype'), { stereotype: v.trim() })} testId="prop-stereotype" />
        )}
        <KindSpecific element={element} />
        <UsedIn element={element} />
      </Section>
      {hasFeatures(element) && <FeatureEditors element={element} />}
      <MemberSections element={element} />
      <AppliedStereotypes element={element} />
    </>
  );
}

function KindSpecific({ element }: { element: ModelElement }) {
  const t = useT();
  const edit = useEdit(element);
  const kindOptions = (keys: readonly string[], prefix: string) => keys.map((k) => ({ value: k, label: t(`${prefix}.${k}` as MessageKey) }));
  switch (element.kind) {
    case 'class':
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <CheckField label={t('inspector.abstract')} checked={element.isAbstract} onChange={(v) => edit(t('inspector.abstract'), { isAbstract: v })} testId="prop-abstract" />
          <CheckField label={t('inspector.leaf')} checked={element.isLeaf} onChange={(v) => edit(t('inspector.leaf'), { isLeaf: v })} />
          <CheckField label={t('inspector.active')} checked={element.isActive} onChange={(v) => edit(t('inspector.active'), { isActive: v })} />
        </div>
      );
    case 'interface':
    case 'dataType':
    case 'signal':
    case 'component':
    case 'actor':
    case 'useCase':
      return <CheckField label={t('inspector.abstract')} checked={element.isAbstract} onChange={(v) => edit(t('inspector.abstract'), { isAbstract: v })} />;
    case 'state':
      return (
        <>
          <TextField label={t('inspector.entry')} value={element.entry} onCommit={(v) => edit(t('inspector.entry'), { entry: v.trim() })} testId="prop-entry" />
          <TextField label={t('inspector.doActivity')} value={element.doActivity} onCommit={(v) => edit(t('inspector.doActivity'), { doActivity: v.trim() })} />
          <TextField label={t('inspector.exit')} value={element.exit} onCommit={(v) => edit(t('inspector.exit'), { exit: v.trim() })} />
        </>
      );
    case 'pseudostate':
      return <SelectField label={t('inspector.pseudoKind')} value={element.pseudoKind} options={kindOptions(PSEUDO_KINDS, 'pseudoKind')} onChange={(v) => edit(t('inspector.pseudoKind'), { pseudoKind: v })} />;
    case 'controlNode':
      return <SelectField label={t('inspector.nodeKind')} value={element.nodeKind} options={kindOptions(CONTROL_KINDS, 'controlKind')} onChange={(v) => edit(t('inspector.nodeKind'), { nodeKind: v })} />;
    case 'action':
      return <SelectField label={t('inspector.actionKind')} value={element.actionKind} options={kindOptions(ACTION_KINDS, 'actionKind')} onChange={(v) => edit(t('inspector.actionKind'), { actionKind: v })} />;
    case 'objectNode':
      return <TextField label={t('inspector.typeText')} value={element.typeName} onCommit={(v) => edit(t('common.type'), { typeName: v.trim() })} />;
    case 'node':
      return <SelectField label={t('inspector.nodeKind')} value={element.nodeKind} options={kindOptions(['node', 'device', 'executionEnvironment'], 'nodeKind')} onChange={(v) => edit(t('inspector.nodeKind'), { nodeKind: v })} />;
    case 'artifact':
      return <TextField label={t('inspector.fileName')} value={element.fileName} onCommit={(v) => edit(t('inspector.fileName'), { fileName: v.trim() })} />;
    case 'lifeline':
      return (
        <>
          <ClassifierSelect label={t('inspector.typeClassifier')} kinds={TYPE_KINDS} value={element.typeElementId} onChange={(id) => edit(t('common.type'), { typeElementId: id })} />
          {!element.typeElementId && <TextField label={t('inspector.typeText')} value={element.typeName} onCommit={(v) => edit(t('common.type'), { typeName: v.trim() })} testId="prop-type-name" />}
          <SelectField label={t('inspector.headStyle')} value={element.headStyle} options={(['object', 'actor'] as const).map((v) => ({ value: v, label: t(`headStyle.${v}`) }))} onChange={(v) => edit(t('inspector.headStyle'), { headStyle: v })} />
        </>
      );
    case 'message':
      return (
        <>
          {element.sort !== 'reply' ? (
            <TextField label={t('inspector.arguments')} value={element.arguments} onCommit={(v) => edit(t('inspector.arguments'), { arguments: v.trim() })} testId="prop-arguments" />
          ) : null}
          <SelectField
            label={t('inspector.messageSort')}
            value={element.sort}
            options={(['synchronous', 'asynchronous', 'reply', 'create', 'destroy'] as const).map((v) => ({ value: v, label: t(`messageSort.${v}`) }))}
            onChange={(v) => edit(t('inspector.messageSort'), { sort: v })}
            testId="prop-message-sort"
          />
          <TextField label={t('inspector.guard')} value={element.guard} onCommit={(v) => edit(t('inspector.guard'), { guard: parseGuard(v) })} />
        </>
      );
    case 'combinedFragment':
      return <SelectField label={t('inspector.operator')} value={element.operator} options={OPERATORS.map((o) => ({ value: o, label: o }))} onChange={(v) => edit(t('inspector.operator'), { operator: v })} testId="prop-operator" />;
    case 'instanceSpecification':
      return (
        <>
          <ClassifierSelect label={t('inspector.classifier')} kinds={TYPE_KINDS} value={element.classifierId} onChange={(id) => edit(t('inspector.classifier'), { classifierId: id })} />
          {!element.classifierId && <TextField label={t('inspector.typeText')} value={element.classifierName} onCommit={(v) => edit(t('inspector.classifier'), { classifierName: v.trim() })} />}
        </>
      );
    case 'port':
    case 'part':
      return (
        <>
          <ClassifierSelect label={t('inspector.typeClassifier')} kinds={TYPE_KINDS} value={element.typeElementId} onChange={(id) => edit(t('common.type'), { typeElementId: id, typeName: id ? '' : element.typeName })} />
          {!element.typeElementId && <TextField label={t('inspector.typeText')} value={element.typeName} onCommit={(v) => edit(t('common.type'), { typeName: v.trim() })} />}
          <MultiplicityField label={t('inspector.multiplicity')} value={element.multiplicity} onCommit={(v) => edit(t('inspector.multiplicity'), { multiplicity: v })} />
          {element.kind === 'part' ? (
            <SelectField label={t('inspector.aggregation')} value={element.aggregation} options={(['none', 'shared', 'composite'] as const).map((v) => ({ value: v, label: t(`aggregation.${v}`) }))} onChange={(v) => edit(t('inspector.aggregation'), { aggregation: v })} />
          ) : (
            <div className="flex gap-3">
              <CheckField label={t('inspector.service')} checked={element.isService} onChange={(v) => edit(t('inspector.service'), { isService: v })} />
              <CheckField label={t('inspector.behavior')} checked={element.isBehavior} onChange={(v) => edit(t('inspector.behavior'), { isBehavior: v })} />
            </div>
          )}
        </>
      );
    default:
      return null;
  }
}

function MemberSections({ element }: { element: ModelElement }) {
  const t = useT();
  switch (element.kind) {
    case 'useCase':
      return (
        <NamedListEditor
          title={t('inspector.extensionPoints')}
          elementId={element.id}
          collection="extensionPoints"
          items={element.extensionPoints}
          addLabel={t('inspector.addExtensionPoint')}
          onAdd={() => run({ type: 'member/add', elementId: element.id, collection: 'extensionPoints', member: makeExtensionPoint({ id: uuidGenerator.next(), name: `${t('defaultName.extensionPoint')}${element.extensionPoints.length + 1}` }) }, { label: t('inspector.addExtensionPoint') })}
        />
      );
    case 'combinedFragment':
      return (
        <NamedListEditor
          title={t('inspector.operands')}
          elementId={element.id}
          collection="operands"
          items={element.operands}
          field="guard"
          fieldLabel="inspector.guard"
          addLabel={t('inspector.addOperand')}
          onAdd={() => run({ type: 'member/add', elementId: element.id, collection: 'operands', member: makeOperand({ id: uuidGenerator.next(), guard: '' }) }, { label: t('inspector.addOperand') })}
        />
      );
    case 'instanceSpecification':
      return <SlotsEditor element={element} />;
    case 'stereotype':
      return (
        <NamedListEditor
          title={t('inspector.tagDefinitions')}
          elementId={element.id}
          collection="tagDefinitions"
          items={element.tagDefinitions}
          addLabel={t('inspector.addTag')}
          onAdd={() => run({ type: 'member/add', elementId: element.id, collection: 'tagDefinitions', member: makeTagDefinition({ id: uuidGenerator.next(), name: `${t('defaultName.tag')}${element.tagDefinitions.length + 1}` }) }, { label: t('inspector.addTag') })}
        />
      );
    default:
      return null;
  }
}

function SlotsEditor({ element }: { element: ElementOf<'instanceSpecification'> }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const classifier = element.classifierId ? doc.modelElements[element.classifierId] : undefined;
  const features = classifier && hasFeatures(classifier) ? classifier.attributes : [];
  const addSlot = (featureId?: ID) => {
    const feature = features.find((f) => f.id === featureId);
    run(
      { type: 'member/add', elementId: element.id, collection: 'slots', member: makeSlot({ id: uuidGenerator.next(), name: feature?.name ?? `${t('defaultName.slot')}${element.slots.length + 1}`, definingFeatureId: feature?.id ?? null, value: feature?.defaultValue ?? '' }) },
      { label: t('inspector.addSlot') },
    );
  };
  const unused = features.filter((f) => !element.slots.some((s) => s.definingFeatureId === f.id));
  return (
    <Section
      title={t('inspector.slots')}
      actions={
        <IconButton label={t('inspector.addSlot')} className="h-6 w-6" onClick={() => addSlot()} data-testid="add-slot">
          <Plus size={14} />
        </IconButton>
      }
    >
      {element.slots.map((slot) => {
        const set = (patch: FieldPatch) => run({ type: 'member/update', elementId: element.id, collection: 'slots', memberId: slot.id, patch }, { label: t('history.edit', { field: slot.name }) });
        return (
          <div key={slot.id} className="flex items-center gap-1">
            <TextField compact label={t('inspector.feature')} value={slot.name} onCommit={(v) => set({ name: v.trim() })} />
            <span className="text-faint">=</span>
            <TextField compact label={t('common.value')} value={slot.value} onCommit={(v) => set({ value: v.trim() })} />
            <IconButton label={t('common.delete')} className="h-6 w-6 shrink-0 hover:text-danger" onClick={() => run({ type: 'member/delete', elementId: element.id, collection: 'slots', memberId: slot.id }, { label: t('history.delete') })}>
              ×
            </IconButton>
          </div>
        );
      })}
      {unused.length > 0 && (
        <SelectField label={t('inspector.addSlot')} value="" options={[{ value: '', label: '—' }, ...unused.map((f) => ({ value: f.id, label: f.name }))]} onChange={(id) => id && addSlot(id)} />
      )}
    </Section>
  );
}
