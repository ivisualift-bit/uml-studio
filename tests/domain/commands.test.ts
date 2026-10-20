import { describe, expect, it } from 'vitest';
import { executeCommands } from '@/domain/commands/engine';
import { createEmptyProject, makeAttribute, makeElement, makeView } from '@/domain/model/factory';
import { createHistory, recordEntry, redo, undo } from '@/domain/commands/history';
import { showElementCommands } from '@/domain/commands/creators';
import { viewsOfElement } from '@/domain/services/queries';
import { checkIntegrity } from '@/domain/services/integrity';
import { sequentialIds } from '@/domain/ids';
import { addNode, apply, connect, newProject, withDiagram } from '../helpers';

describe('project factory', () => {
  it('creates a canonical, integrity-clean empty project', () => {
    const doc = createEmptyProject({ name: 'P', ids: sequentialIds(), now: new Date('2026-01-01T00:00:00Z') });
    expect(Object.keys(doc.modelElements)).toEqual([doc.rootModelId]);
    expect(doc.modelElements[doc.rootModelId]?.kind).toBe('model');
    expect(checkIntegrity(doc)).toEqual([]);
  });
});

describe('command engine', () => {
  it('adds a class with a view and keeps IDs stable', () => {
    const f = withDiagram('class');
    const { elementId, viewId } = addNode(f, f.diagramId, { kind: 'class', baseName: 'Class' }, 100, 80);
    const el = f.doc.modelElements[elementId];
    expect(el?.kind).toBe('class');
    expect(el?.name).toBe('Class1');
    expect(el?.ownerId).toBe(f.doc.rootModelId);
    const view = f.doc.diagrams[f.diagramId]?.views[viewId];
    expect(view).toMatchObject({ kind: 'node', elementId, x: 100, y: 80 });
  });

  it('rejects a transaction atomically when any command fails', () => {
    const f = withDiagram('class');
    const { elementId } = addNode(f, f.diagramId, { kind: 'class', baseName: 'Class' });
    const before = f.doc;
    const outcome = executeCommands(before, [
      { type: 'element/update', elementId, patch: { name: 'Renamed' } },
      { type: 'element/update', elementId: 'missing', patch: { name: 'x' } },
    ]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('notFound');
    expect(before.modelElements[elementId]?.name).toBe('Class1');
  });

  it('rejects mutations that break schema (e.g. non-finite coordinates) or immutable fields', () => {
    const f = withDiagram('class');
    const { elementId, viewId } = addNode(f, f.diagramId, { kind: 'class' });
    const nan = executeCommands(f.doc, [{ type: 'view/update', diagramId: f.diagramId, viewId, patch: { x: Number.NaN } }]);
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.code).toBe('schema');
    const kind = executeCommands(f.doc, [{ type: 'element/update', elementId, patch: { kind: 'interface' } }]);
    expect(kind.ok).toBe(false);
    if (!kind.ok) expect(kind.code).toBe('immutableField');
    const unknownField = executeCommands(f.doc, [{ type: 'element/update', elementId, patch: { bogus: 1 } }]);
    expect(unknownField.ok).toBe(false);
  });

  it('rejects dangling owners through the integrity check', () => {
    const doc = newProject();
    const outcome = executeCommands(doc, [
      { type: 'element/add', elements: [makeElement('class', { id: 'c1', name: 'A', ownerId: 'nope' })] },
    ]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('integrity');
  });

  it('rejects ownership cycles and illegal owners on move', () => {
    const f = withDiagram('class');
    const p1 = addNode(f, f.diagramId, { kind: 'package', baseName: 'pkg' });
    const p2 = addNode(f, f.diagramId, { kind: 'package', baseName: 'pkg' }, 300, 0);
    f.doc = apply(f.doc, { type: 'element/move', elementId: p2.elementId, newOwnerId: p1.elementId });
    const cycle = executeCommands(f.doc, [{ type: 'element/move', elementId: p1.elementId, newOwnerId: p2.elementId }]);
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.code).toBe('ownershipCycle');
    const cls = addNode(f, f.diagramId, { kind: 'class' }, 600, 0);
    const illegal = executeCommands(f.doc, [{ type: 'element/move', elementId: p1.elementId, newOwnerId: cls.elementId }]);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.code).toBe('ownershipNotAllowed');
  });

  it('adds, edits, reorders and removes members', () => {
    const f = withDiagram('class');
    const { elementId } = addNode(f, f.diagramId, { kind: 'class' });
    f.doc = apply(f.doc, [
      { type: 'member/add', elementId, collection: 'attributes', member: { id: 'a1', name: 'name', type: 'String' } },
      { type: 'member/add', elementId, collection: 'attributes', member: { id: 'a2', name: 'age', type: 'Integer' } },
      { type: 'member/add', elementId, collection: 'operations', member: { id: 'o1', name: 'enroll' } },
      { type: 'member/add', elementId, collection: 'parameters', operationId: 'o1', member: { id: 'p1', name: 'course', type: 'Course' } },
    ]);
    f.doc = apply(f.doc, { type: 'member/move', elementId, collection: 'attributes', memberId: 'a2', toIndex: 0 });
    f.doc = apply(f.doc, { type: 'member/update', elementId, collection: 'attributes', memberId: 'a1', patch: { isStatic: true } });
    const el = f.doc.modelElements[elementId];
    if (el?.kind !== 'class') throw new Error('expected class');
    expect(el.attributes.map((a) => a.name)).toEqual(['age', 'name']);
    expect(el.attributes[1]).toEqual(makeAttribute({ id: 'a1', name: 'name', type: 'String', isStatic: true }));
    expect(el.operations[0]?.parameters[0]?.name).toBe('course');
    f.doc = apply(f.doc, { type: 'member/delete', elementId, collection: 'attributes', memberId: 'a1' });
    const after = f.doc.modelElements[elementId];
    expect(after?.kind === 'class' && after.attributes.length).toBe(1);
  });

  it('rejects duplicate member IDs across the document', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class' });
    const b = addNode(f, f.diagramId, { kind: 'class' }, 300);
    f.doc = apply(f.doc, { type: 'member/add', elementId: a.elementId, collection: 'attributes', member: { id: 'dup', name: 'x' } });
    const outcome = executeCommands(f.doc, [
      { type: 'member/add', elementId: b.elementId, collection: 'attributes', member: { id: 'dup', name: 'y' } },
    ]);
    expect(outcome.ok).toBe(false);
  });
});

describe('history', () => {
  it('undoes and redoes to identical documents and coalesces merge keys', () => {
    const f = withDiagram('class');
    const { elementId, viewId } = addNode(f, f.diagramId, { kind: 'class' });
    let history = createHistory();
    let doc = f.doc;
    const step = (commands: Parameters<typeof executeCommands>[1], mergeKey?: string, t = 0) => {
      const out = executeCommands(doc, commands);
      if (!out.ok) throw new Error(out.message);
      history = recordEntry(history, { label: 'x', patches: out.patches, inversePatches: out.inversePatches, timestamp: t, mergeKey, affectedDiagramIds: out.affectedDiagramIds });
      doc = out.doc;
    };
    const original = doc;
    step([{ type: 'element/update', elementId, patch: { name: 'Person' } }]);
    step([{ type: 'view/move', diagramId: f.diagramId, viewIds: [viewId], dx: 10, dy: 0 }], 'nudge', 1000);
    step([{ type: 'view/move', diagramId: f.diagramId, viewIds: [viewId], dx: 10, dy: 0 }], 'nudge', 1500);
    expect(history.past).toHaveLength(2);
    const afterEdits = doc;
    const u1 = undo(doc, history)!;
    expect(u1.doc.diagrams[f.diagramId]?.views[viewId]).toMatchObject({ x: 0 });
    const u2 = undo(u1.doc, u1.history)!;
    expect(u2.doc).toEqual(original);
    expect(undo(u2.doc, u2.history)).toBeNull();
    const r1 = redo(u2.doc, u2.history)!;
    const r2 = redo(r1.doc, r1.history)!;
    expect(r2.doc).toEqual(afterEdits);
    expect(r2.doc.modelElements[elementId]?.id).toBe(elementId);
  });

  it('caps history length', () => {
    let history = createHistory(3);
    for (let i = 0; i < 5; i += 1) {
      history = recordEntry(history, { label: String(i), patches: [{ op: 'replace', path: ['name'], value: String(i) }], inversePatches: [], timestamp: i * 5000, affectedDiagramIds: [] });
    }
    expect(history.past.map((e) => e.label)).toEqual(['2', '3', '4']);
  });
});

describe('model/view separation', () => {
  it('shows one semantic class in two diagrams; rename is shared; removing one view keeps the model', () => {
    const f = withDiagram('class', 'A');
    const d2 = withDiagram('class', 'B', f);
    f.doc = d2.doc;
    const customer = addNode(f, f.diagramId, { kind: 'class', name: 'Customer' });
    const shown = showElementCommands(f.doc, {
      diagramId: d2.diagramId,
      elementId: customer.elementId,
      position: { x: 50, y: 50 },
      size: { width: 120, height: 60 },
      ids: f.ids,
    });
    if (!shown.ok) throw new Error(shown.reason);
    f.doc = apply(f.doc, shown.commands);
    expect(viewsOfElement(f.doc, customer.elementId)).toHaveLength(2);
    expect(Object.values(f.doc.modelElements).filter((e) => e.kind === 'class')).toHaveLength(1);

    f.doc = apply(f.doc, { type: 'element/update', elementId: customer.elementId, patch: { name: 'Client' } });
    expect(f.doc.modelElements[customer.elementId]?.name).toBe('Client');

    f.doc = apply(f.doc, { type: 'view/remove', diagramId: f.diagramId, viewIds: [customer.viewId], deleteScopedOrphans: true });
    expect(f.doc.modelElements[customer.elementId]).toBeDefined();
    expect(viewsOfElement(f.doc, customer.elementId)).toHaveLength(1);

    f.doc = apply(f.doc, { type: 'element/delete', elementIds: [customer.elementId] });
    expect(f.doc.modelElements[customer.elementId]).toBeUndefined();
    expect(viewsOfElement(f.doc, customer.elementId)).toHaveLength(0);
    expect(checkIntegrity(f.doc)).toEqual([]);
  });

  it('re-displays existing relationships when an element view is added back', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'A' });
    const b = addNode(f, f.diagramId, { kind: 'class', name: 'B' }, 300);
    const rel = connect(f, f.diagramId, 'association', a.viewId, b.viewId);
    f.doc = apply(f.doc, { type: 'view/remove', diagramId: f.diagramId, viewIds: [a.viewId], deleteScopedOrphans: true });
    expect(f.doc.modelElements[rel.relationshipId]).toBeDefined(); // relationship kept: both ends still exist
    expect(f.doc.diagrams[f.diagramId]?.views[rel.edgeViewId]).toBeUndefined();
    const shown = showElementCommands(f.doc, { diagramId: f.diagramId, elementId: a.elementId, position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, ids: f.ids });
    if (!shown.ok) throw new Error(shown.reason);
    f.doc = apply(f.doc, shown.commands);
    const edges = Object.values(f.doc.diagrams[f.diagramId]!.views).filter((v) => v.kind === 'edge');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ elementId: rel.relationshipId, targetViewId: b.viewId });
  });

  it('deletes a relationship from the model when its last edge view is explicitly deleted', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class' });
    const b = addNode(f, f.diagramId, { kind: 'class' }, 300);
    const rel = connect(f, f.diagramId, 'generalization', a.viewId, b.viewId);
    f.doc = apply(f.doc, { type: 'view/remove', diagramId: f.diagramId, viewIds: [rel.edgeViewId], deleteScopedOrphans: true });
    expect(f.doc.modelElements[rel.relationshipId]).toBeUndefined();
  });

  it('cascades element deletion to relationships, nested elements, owned diagrams and views', () => {
    const f = withDiagram('class');
    const pkg = addNode(f, f.diagramId, { kind: 'package', name: 'domain' }, 0, 0, { width: 400, height: 300 });
    const inside = addNode(f, f.diagramId, { kind: 'class', name: 'Inner' }, 100, 100);
    expect(f.doc.modelElements[inside.elementId]?.ownerId).toBe(pkg.elementId);
    const outside = addNode(f, f.diagramId, { kind: 'class', name: 'Outer' }, 600, 100);
    const rel = connect(f, f.diagramId, 'association', outside.viewId, inside.viewId);
    f.doc = apply(f.doc, { type: 'element/delete', elementIds: [pkg.elementId] });
    expect(f.doc.modelElements[inside.elementId]).toBeUndefined();
    expect(f.doc.modelElements[rel.relationshipId]).toBeUndefined();
    expect(f.doc.modelElements[outside.elementId]).toBeDefined();
    expect(Object.values(f.doc.diagrams[f.diagramId]!.views).map((v) => v.id)).toEqual([outside.viewId]);
    expect(checkIntegrity(f.doc)).toEqual([]);
  });

  it('clears optional type references when the referenced class is deleted', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'Order' });
    const b = addNode(f, f.diagramId, { kind: 'class', name: 'Customer' }, 300);
    f.doc = apply(f.doc, {
      type: 'member/add',
      elementId: a.elementId,
      collection: 'attributes',
      member: { id: 'att', name: 'customer', type: 'Customer', typeElementId: b.elementId },
    });
    f.doc = apply(f.doc, { type: 'element/delete', elementIds: [b.elementId] });
    const order = f.doc.modelElements[a.elementId];
    expect(order?.kind === 'class' && order.attributes[0]).toMatchObject({ type: 'Customer', typeElementId: null });
  });

  it('refuses to delete the root model', () => {
    const doc = newProject();
    const outcome = executeCommands(doc, [{ type: 'element/delete', elementIds: [doc.rootModelId] }]);
    expect(outcome.ok).toBe(false);
  });
});

describe('relationship rules', () => {
  it('rejects an include from an actor and self-generalization', () => {
    const f = withDiagram('useCase');
    const actor = addNode(f, f.diagramId, { kind: 'actor' });
    const uc = addNode(f, f.diagramId, { kind: 'useCase' }, 300);
    expect(() => connect(f, f.diagramId, 'include', actor.viewId, uc.viewId)).toThrow(/invalidSource/);
    expect(() => connect(f, f.diagramId, 'generalization', uc.viewId, uc.viewId)).toThrow(/selfNotAllowed/);
    const uc2 = addNode(f, f.diagramId, { kind: 'useCase' }, 600);
    const inc = connect(f, f.diagramId, 'include', uc.viewId, uc2.viewId);
    expect(f.doc.modelElements[inc.relationshipId]).toMatchObject({ kind: 'include', sourceId: uc.elementId, targetId: uc2.elementId });
  });

  it('creates aggregation/composition as associations with the diamond on the whole (source) end', () => {
    const f = withDiagram('class');
    const whole = addNode(f, f.diagramId, { kind: 'class', name: 'Order' });
    const part = addNode(f, f.diagramId, { kind: 'class', name: 'Line' }, 300);
    const comp = connect(f, f.diagramId, 'composition', whole.viewId, part.viewId);
    expect(f.doc.modelElements[comp.relationshipId]).toMatchObject({
      kind: 'association',
      sourceEnd: { aggregation: 'composite' },
      targetEnd: { aggregation: 'none' },
    });
  });

  it('forbids transitions into an initial pseudostate and out of a final state', () => {
    const f = withDiagram('stateMachine');
    const init = addNode(f, f.diagramId, { kind: 'pseudostate', subKind: 'initial' });
    const s = addNode(f, f.diagramId, { kind: 'state' }, 200);
    const fin = addNode(f, f.diagramId, { kind: 'finalState' }, 400);
    expect(() => connect(f, f.diagramId, 'transition', s.viewId, init.viewId)).toThrow(/initialTarget/);
    expect(() => connect(f, f.diagramId, 'transition', fin.viewId, s.viewId)).toThrow(/invalidSource/);
    connect(f, f.diagramId, 'transition', init.viewId, s.viewId);
    connect(f, f.diagramId, 'transition', s.viewId, s.viewId); // self transition is legal
  });

  it('reconnects a relationship end and its edge view atomically', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class' });
    const b = addNode(f, f.diagramId, { kind: 'class' }, 300);
    const c = addNode(f, f.diagramId, { kind: 'class' }, 600);
    const rel = connect(f, f.diagramId, 'dependency', a.viewId, b.viewId);
    f.doc = apply(f.doc, {
      type: 'element/reconnect',
      relationshipId: rel.relationshipId,
      end: 'target',
      newElementId: c.elementId,
      edgeUpdates: [{ diagramId: f.diagramId, edgeViewId: rel.edgeViewId, nodeViewId: c.viewId }],
    });
    expect(f.doc.modelElements[rel.relationshipId]).toMatchObject({ targetId: c.elementId });
    expect(f.doc.diagrams[f.diagramId]?.views[rel.edgeViewId]).toMatchObject({ targetViewId: c.viewId });
  });
});

describe('view commands', () => {
  it('moves container children and translates internal edge waypoints', () => {
    const f = withDiagram('class');
    const pkg = addNode(f, f.diagramId, { kind: 'package' }, 0, 0, { width: 500, height: 400 });
    const a = addNode(f, f.diagramId, { kind: 'class' }, 50, 50);
    const b = addNode(f, f.diagramId, { kind: 'class' }, 250, 250);
    const rel = connect(f, f.diagramId, 'association', a.viewId, b.viewId);
    f.doc = apply(f.doc, { type: 'view/update', diagramId: f.diagramId, viewId: rel.edgeViewId, patch: { waypoints: [{ x: 100, y: 300 }] } });
    f.doc = apply(f.doc, { type: 'view/move', diagramId: f.diagramId, viewIds: [pkg.viewId], dx: 100, dy: 20 });
    const views = f.doc.diagrams[f.diagramId]!.views;
    expect(views[a.viewId]).toMatchObject({ x: 150, y: 70, containerViewId: pkg.viewId });
    expect(views[b.viewId]).toMatchObject({ x: 350, y: 270 });
    expect(views[rel.edgeViewId]).toMatchObject({ waypoints: [{ x: 200, y: 320 }] });
  });

  it('reorders z-order', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class' });
    const b = addNode(f, f.diagramId, { kind: 'class' }, 300);
    f.doc = apply(f.doc, { type: 'view/reorder', diagramId: f.diagramId, viewIds: [a.viewId], position: 'front' });
    expect(Object.keys(f.doc.diagrams[f.diagramId]!.views)).toEqual([b.viewId, a.viewId]);
  });

  it('rejects edge views whose endpoints do not match the relationship', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class' });
    const b = addNode(f, f.diagramId, { kind: 'class' }, 300);
    const rel = connect(f, f.diagramId, 'association', a.viewId, b.viewId);
    const bad = makeView('edge', { id: 'bad-edge', elementId: rel.relationshipId, sourceViewId: b.viewId, targetViewId: a.viewId });
    const outcome = executeCommands(f.doc, [{ type: 'view/add', diagramId: f.diagramId, views: [bad] }]);
    expect(outcome.ok).toBe(false);
  });
});
