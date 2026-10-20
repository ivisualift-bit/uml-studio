import { describe, expect, it } from 'vitest';
import { cloneProjectWithFreshIds, collectDeclaredIds } from '@/domain/services/cloneAndRemap';
import { copySelection, pasteCommands } from '@/domain/commands/creators';
import { checkIntegrity } from '@/domain/services/integrity';
import { sequentialIds } from '@/domain/ids';
import { isPlainObject } from '@/domain/util';
import { addNode, apply, connect, withDiagram } from '../helpers';

function richDoc() {
  const f = withDiagram('class');
  const a = addNode(f, f.diagramId, { kind: 'class', name: 'Order' });
  const b = addNode(f, f.diagramId, { kind: 'class', name: 'Customer' }, 300);
  f.doc = apply(f.doc, {
    type: 'member/add',
    elementId: a.elementId,
    collection: 'attributes',
    member: { id: 'attr-1', name: 'customer', type: 'Customer', typeElementId: b.elementId },
  });
  const rel = connect(f, f.diagramId, 'association', a.viewId, b.viewId);
  return { f, a, b, rel };
}

describe('id remapping', () => {
  it('only uses id/…Id/…Ids fields for identifiers (schema invariant)', () => {
    const { f } = richDoc();
    const ids = new Set(collectDeclaredIds(f.doc));
    const offenders: string[] = [];
    const walk = (node: unknown, key: string, inIdRecord: boolean) => {
      if (typeof node === 'string') {
        if (ids.has(node) && !(key === 'id' || key.endsWith('Id') || key.endsWith('Ids') || inIdRecord)) offenders.push(key);
        return;
      }
      if (Array.isArray(node)) node.forEach((v) => walk(v, key, false));
      else if (isPlainObject(node)) {
        for (const [k, v] of Object.entries(node)) {
          if (ids.has(k) && !['modelElements', 'diagrams', 'views', 'operandYs'].includes(key)) offenders.push(`key:${key}`);
          walk(v, k, false);
        }
      }
    };
    walk(f.doc, '', false);
    expect(offenders).toEqual([]);
  });

  it('clones a project with entirely fresh, consistent identifiers', () => {
    const { f, a } = richDoc();
    const clone = cloneProjectWithFreshIds(f.doc, sequentialIds('new'));
    const before = new Set(collectDeclaredIds(f.doc));
    const after = collectDeclaredIds(clone);
    expect(after.some((id) => before.has(id))).toBe(false);
    expect(new Set(after).size).toBe(after.length);
    expect(checkIntegrity(clone)).toEqual([]);
    const order = Object.values(clone.modelElements).find((e) => e.name === 'Order');
    const customer = Object.values(clone.modelElements).find((e) => e.name === 'Customer');
    expect(order?.kind === 'class' && order.attributes[0]?.typeElementId).toBe(customer?.id);
    expect(clone.modelElements[a.elementId]).toBeUndefined();
  });
});

describe('copy / paste', () => {
  it('pastes clones with new IDs and remapped internal relationships', () => {
    const { f, a, b, rel } = richDoc();
    const payload = copySelection(f.doc, f.diagramId, [a.viewId, b.viewId]);
    expect(payload?.views.map((v) => v.kind).sort()).toEqual(['edge', 'node', 'node']);
    const pasted = pasteCommands(f.doc, { diagramId: f.diagramId, payload: payload!, offset: { x: 40, y: 40 }, ids: f.ids });
    if (!pasted.ok) throw new Error(pasted.reason);
    f.doc = apply(f.doc, pasted.commands);
    const classes = Object.values(f.doc.modelElements).filter((e) => e.kind === 'class');
    expect(classes).toHaveLength(4);
    const associations = Object.values(f.doc.modelElements).filter((e) => e.kind === 'association');
    expect(associations).toHaveLength(2);
    const pastedAssoc = associations.find((r) => r.id !== rel.relationshipId)!;
    expect(pastedAssoc.kind === 'association' && [pastedAssoc.sourceId, pastedAssoc.targetId].some((id) => id === a.elementId || id === b.elementId)).toBe(false);
    const pastedOrder = classes.find((c) => c.name === 'Order' && c.id !== a.elementId);
    const pastedCustomer = classes.find((c) => c.name === 'Customer' && c.id !== b.elementId);
    expect(pastedOrder?.kind === 'class' && pastedOrder.attributes[0]?.typeElementId).toBe(pastedCustomer?.id);
    expect(checkIntegrity(f.doc)).toEqual([]);
  });

  it('keeps references to non-copied elements that still exist', () => {
    const { f, a, b } = richDoc();
    const payload = copySelection(f.doc, f.diagramId, [a.viewId]);
    const pasted = pasteCommands(f.doc, { diagramId: f.diagramId, payload: payload!, offset: { x: 20, y: 20 }, ids: f.ids });
    if (!pasted.ok) throw new Error(pasted.reason);
    f.doc = apply(f.doc, pasted.commands);
    const copy = Object.values(f.doc.modelElements).find((e) => e.name === 'Order' && e.id !== a.elementId);
    expect(copy?.kind === 'class' && copy.attributes[0]?.typeElementId).toBe(b.elementId);
  });
});
