import { run } from '@/app/actions';
import type { FieldPatch } from '@/domain/commands/types';
import type { ID } from '@/domain/schemas/common';
import type { Compartment, DiagramView, ViewStyle } from '@/domain/schemas/views';
import { Button } from '@/components/ui/controls';
import { useT } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { CheckField, ColorField, NumberField, Row, Section, SelectField } from './fields';

function patchViews(diagramId: ID, viewIds: ID[], patch: (view: DiagramView) => FieldPatch | null, label: string) {
  const doc = useDocumentStore.getState().doc;
  const diagram = doc?.diagrams[diagramId];
  if (!diagram) return;
  const patches: Record<ID, FieldPatch> = {};
  for (const id of viewIds) {
    const view = diagram.views[id];
    const p = view ? patch(view) : null;
    if (p) patches[id] = p;
  }
  if (Object.keys(patches).length) run({ type: 'view/updateMany', diagramId, patches }, { label });
}

const COMPARTMENTS_BY_KIND: Record<string, Array<{ key: Compartment; label: 'inspector.showAttributes' | 'inspector.showOperations' | 'inspector.showLiterals' | 'inspector.showInternal' | 'inspector.showSlots' | 'inspector.showExtensionPoints' }>> = {
  class: [
    { key: 'attributes', label: 'inspector.showAttributes' },
    { key: 'operations', label: 'inspector.showOperations' },
  ],
  interface: [
    { key: 'attributes', label: 'inspector.showAttributes' },
    { key: 'operations', label: 'inspector.showOperations' },
  ],
  dataType: [
    { key: 'attributes', label: 'inspector.showAttributes' },
    { key: 'operations', label: 'inspector.showOperations' },
  ],
  signal: [
    { key: 'attributes', label: 'inspector.showAttributes' },
    { key: 'operations', label: 'inspector.showOperations' },
  ],
  enumeration: [
    { key: 'literals', label: 'inspector.showLiterals' },
    { key: 'attributes', label: 'inspector.showAttributes' },
    { key: 'operations', label: 'inspector.showOperations' },
  ],
  state: [{ key: 'internalActivities', label: 'inspector.showInternal' }],
  instanceSpecification: [{ key: 'slots', label: 'inspector.showSlots' }],
  useCase: [{ key: 'extensionPoints', label: 'inspector.showExtensionPoints' }],
};

export function StyleProperties({ diagramId, viewIds }: { diagramId: ID; viewIds: ID[] }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const diagram = doc.diagrams[diagramId];
  if (!diagram) return null;
  const views = viewIds.map((id) => diagram.views[id]).filter((v): v is DiagramView => !!v);
  if (!views.length) return null;
  const first = views[0]!;
  const style: ViewStyle = first.style;
  const setStyle = (key: keyof ViewStyle, value: string | number | undefined) =>
    patchViews(diagramId, viewIds, (v) => ({ style: { ...v.style, [key]: value } }), t('history.style'));
  const single = views.length === 1;
  const element = single && 'elementId' in first ? doc.modelElements[first.elementId] : undefined;

  return (
    <>
      {single && (first.kind === 'node' || first.kind === 'note') && (
        <Section title={t('inspector.notation')}>
          <Row>
            <NumberField label={t('inspector.x')} value={first.x} onCommit={(x) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { x }, recomputeContainment: true }, { label: t('history.move') })} testId="style-x" />
            <NumberField label={t('inspector.y')} value={first.y} onCommit={(y) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { y }, recomputeContainment: true }, { label: t('history.move') })} testId="style-y" />
            <NumberField label={t('inspector.width')} value={first.width} min={1} onCommit={(width) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { width }, recomputeContainment: true }, { label: t('history.resize') })} />
            <NumberField label={t('inspector.height')} value={first.height} min={1} onCommit={(height) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { height }, recomputeContainment: true }, { label: t('history.resize') })} />
          </Row>
          {first.kind === 'node' && element && COMPARTMENTS_BY_KIND[element.kind] && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{t('inspector.compartments')}</span>
              {COMPARTMENTS_BY_KIND[element.kind]!.map((c) => (
                <CheckField
                  key={c.key}
                  label={t(c.label)}
                  checked={!first.hiddenCompartments.includes(c.key)}
                  onChange={(show) =>
                    run(
                      { type: 'view/update', diagramId, viewId: first.id, patch: { hiddenCompartments: show ? first.hiddenCompartments.filter((k) => k !== c.key) : [...first.hiddenCompartments, c.key] } },
                      { label: t('history.style') },
                    )
                  }
                />
              ))}
            </div>
          )}
          {first.kind === 'node' && element && (element.kind === 'actor' || element.kind === 'interface') && (
            <CheckField
              label={t('inspector.alternateNotation')}
              checked={first.variant === 'alternate'}
              onChange={(on) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { variant: on ? 'alternate' : 'default' } }, { label: t('history.style') })}
            />
          )}
        </Section>
      )}
      {single && first.kind === 'edge' && (
        <Section title={t('inspector.routing')}>
          <SelectField
            label={t('inspector.routing')}
            value={first.routing}
            options={[
              { value: 'straight', label: t('cmd.routingStraight') },
              { value: 'orthogonal', label: t('cmd.routingOrthogonal') },
            ]}
            onChange={(routing) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { routing, waypoints: [] } }, { label: t('history.route') })}
            testId="style-routing"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="subtle" disabled={!first.waypoints.length} onClick={() => run({ type: 'view/update', diagramId, viewId: first.id, patch: { waypoints: [] } }, { label: t('history.route') })}>
              {t('inspector.clearWaypoints')}
            </Button>
            <Button size="sm" variant="subtle" disabled={!Object.keys(first.labelOffsets).length} onClick={() => run({ type: 'view/update', diagramId, viewId: first.id, patch: { labelOffsets: {} } }, { label: t('history.move') })}>
              {t('inspector.resetLabels')}
            </Button>
          </div>
        </Section>
      )}
      {single && first.kind === 'message' && (
        <Section title={t('inspector.notation')}>
          <Row>
            <NumberField
              label={t('inspector.sendY')}
              value={first.sendY}
              min={0}
              onCommit={(sendY) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { sendY, receiveY: sendY + (first.receiveY - first.sendY) } }, { label: t('history.move') })}
              testId="style-sendY"
            />
            <NumberField label={t('inspector.receiveY')} value={first.receiveY} min={0} onCommit={(receiveY) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { receiveY } }, { label: t('history.move') })} />
          </Row>
        </Section>
      )}
      {single && first.kind === 'activation' && (
        <Section title={t('inspector.notation')}>
          <Row>
            <NumberField label={t('inspector.startY')} value={first.startY} min={0} onCommit={(startY) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { startY } }, { label: t('history.resize') })} />
            <NumberField label={t('inspector.endY')} value={first.endY} min={0} onCommit={(endY) => run({ type: 'view/update', diagramId, viewId: first.id, patch: { endY } }, { label: t('history.resize') })} />
          </Row>
        </Section>
      )}
      <Section title={t('inspector.style')}>
        <Row>
          <ColorField label={t('inspector.fill')} value={style.fill} fallback="#ffffff" onChange={(v) => setStyle('fill', v)} />
          <ColorField label={t('inspector.stroke')} value={style.stroke} fallback="#1f2328" onChange={(v) => setStyle('stroke', v)} />
          <ColorField label={t('inspector.textColor')} value={style.textColor} fallback="#111418" onChange={(v) => setStyle('textColor', v)} />
          <NumberField label={t('inspector.fontSize')} value={style.fontSize ?? 13} min={6} max={72} onCommit={(v) => setStyle('fontSize', v)} />
          <NumberField label={t('inspector.lineWidth')} value={style.lineWidth ?? 1.2} min={0.5} max={8} step={0.1} onCommit={(v) => setStyle('lineWidth', v)} />
        </Row>
        <Button size="sm" variant="subtle" className="self-start" onClick={() => patchViews(diagramId, viewIds, () => ({ style: {} }), t('history.style'))}>
          {t('inspector.resetStyle')}
        </Button>
      </Section>
    </>
  );
}
