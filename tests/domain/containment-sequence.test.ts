import { describe, expect, it } from 'vitest';
import {
  createActivationCommands,
  createFragmentCommands,
  createLifelineCommands,
  createMessageCommands,
} from '@/domain/commands/creators';
import { executeCommands } from '@/domain/commands/engine';
import { checkIntegrity } from '@/domain/services/integrity';
import type { ID } from '@/domain/schemas/common';
import { addNode, apply, withDiagram, type Fixture } from '../helpers';

describe('activity swimlanes', () => {
  it('assigns partition membership when an action is created in or moved between lanes', () => {
    const f = withDiagram('activity');
    const laneA = addNode(f, f.diagramId, { kind: 'activityPartition', name: 'Customer' }, 0, 0, { width: 200, height: 500 });
    const laneB = addNode(f, f.diagramId, { kind: 'activityPartition', name: 'Bank' }, 200, 0, { width: 200, height: 500 });
    const action = addNode(f, f.diagramId, { kind: 'action', name: 'Submit' }, 40, 100, { width: 120, height: 50 });
    const el = () => f.doc.modelElements[action.elementId];
    expect(el()).toMatchObject({ partitionId: laneA.elementId });
    expect(f.doc.diagrams[f.diagramId]?.views[action.viewId]).toMatchObject({ containerViewId: laneA.viewId });

    f.doc = apply(f.doc, { type: 'view/move', diagramId: f.diagramId, viewIds: [action.viewId], dx: 200, dy: 0 });
    expect(el()).toMatchObject({ partitionId: laneB.elementId });

    f.doc = apply(f.doc, { type: 'view/move', diagramId: f.diagramId, viewIds: [action.viewId], dx: 400, dy: 0 });
    expect(el()).toMatchObject({ partitionId: null });
    expect(f.doc.diagrams[f.diagramId]?.views[action.viewId]).toMatchObject({ containerViewId: null });
  });

  it('keeps flows intact when a lane (and its actions) is moved', () => {
    const f = withDiagram('activity');
    const lane = addNode(f, f.diagramId, { kind: 'activityPartition' }, 0, 0, { width: 300, height: 500 });
    const a = addNode(f, f.diagramId, { kind: 'action' }, 50, 50);
    const b = addNode(f, f.diagramId, { kind: 'action' }, 50, 250);
    f.doc = apply(f.doc, { type: 'view/move', diagramId: f.diagramId, viewIds: [lane.viewId], dx: 100, dy: 0 });
    const views = f.doc.diagrams[f.diagramId]!.views;
    expect(views[a.viewId]).toMatchObject({ x: 150 });
    expect(views[b.viewId]).toMatchObject({ x: 150 });
  });
});

describe('state machine nesting', () => {
  it('moves semantic ownership into and out of a composite state', () => {
    const f = withDiagram('stateMachine');
    const machineId = f.doc.diagrams[f.diagramId]!.ownerId;
    const composite = addNode(f, f.diagramId, { kind: 'state', name: 'Active' }, 0, 0, { width: 400, height: 300 });
    const inner = addNode(f, f.diagramId, { kind: 'state', name: 'Running' }, 50, 100);
    expect(f.doc.modelElements[inner.elementId]?.ownerId).toBe(composite.elementId);
    f.doc = apply(f.doc, { type: 'view/move', diagramId: f.diagramId, viewIds: [inner.viewId], dx: 600, dy: 0 });
    expect(f.doc.modelElements[inner.elementId]?.ownerId).toBe(machineId);
  });
});

describe('ports and parts', () => {
  it('are owned by the component or class they are dropped on, and refused elsewhere', () => {
    const f = withDiagram('component');
    const comp = addNode(f, f.diagramId, { kind: 'component', name: 'Orders' }, 0, 0, { width: 200, height: 100 });
    const port = addNode(f, f.diagramId, { kind: 'port', name: 'api' }, 192, 40, { width: 16, height: 16 });
    expect(f.doc.modelElements[port.elementId]?.ownerId).toBe(comp.elementId);
    expect(() => addNode(f, f.diagramId, { kind: 'port', name: 'loose' }, 600, 600, { width: 16, height: 16 })).toThrow(/noOwner/);
  });
});

describe('use case boundary', () => {
  it('is a visual container only (no ownership change)', () => {
    const f = withDiagram('useCase');
    const boundary = addNode(f, f.diagramId, { kind: 'subject', name: 'System' }, 0, 0, { width: 400, height: 400 });
    const uc = addNode(f, f.diagramId, { kind: 'useCase' }, 100, 100);
    expect(f.doc.diagrams[f.diagramId]?.views[uc.viewId]).toMatchObject({ containerViewId: boundary.viewId });
    expect(f.doc.modelElements[uc.elementId]?.ownerId).toBe(f.doc.rootModelId);
  });
});

function sequenceFixture() {
  const f = withDiagram('sequence');
  const lifeline = (name: string, x: number) => {
    const created = createLifelineCommands(f.doc, { diagramId: f.diagramId, x, baseName: 'L', headStyle: 'object', name, ids: f.ids });
    if (!created.ok) throw new Error(created.reason);
    f.doc = apply(f.doc, created.commands);
    return { elementId: created.elementId!, viewId: created.viewId! };
  };
  const message = (from: ID | null, to: ID | null, sort: Parameters<typeof createMessageCommands>[1]['sort'], y: number, name = 'm') => {
    const created = createMessageCommands(f.doc, { diagramId: f.diagramId, sourceViewId: from, targetViewId: to, sort, y, name, ids: f.ids });
    if (!created.ok) throw new Error(created.reason);
    f.doc = apply(f.doc, created.commands);
    return { elementId: created.elementId!, viewId: created.viewId! };
  };
  return { f, lifeline, message };
}

function orderedMessageNames(f: Fixture, diagramId: ID): string[] {
  return Object.values(f.doc.diagrams[diagramId]!.views)
    .filter((v) => v.kind === 'message')
    .sort((a, b) => a.sendY - b.sendY || a.id.localeCompare(b.id))
    .map((v) => ('elementId' in v ? (f.doc.modelElements[v.elementId]?.name ?? '') : ''));
}

describe('sequence timeline semantics', () => {
  it('creates lifelines and messages owned by the interaction with timeline views', () => {
    const { f, lifeline, message } = sequenceFixture();
    const diagram = f.doc.diagrams[f.diagramId]!;
    const frontend = lifeline('Frontend', 100);
    const api = lifeline('API', 300);
    const call = message(frontend.viewId, api.viewId, 'synchronous', 120, 'login');
    const self = message(api.viewId, api.viewId, 'synchronous', 160, 'validate');
    expect(f.doc.modelElements[call.elementId]).toMatchObject({ ownerId: diagram.ownerId, sourceLifelineId: frontend.elementId, targetLifelineId: api.elementId });
    const selfView = f.doc.diagrams[f.diagramId]!.views[self.viewId];
    expect(selfView?.kind === 'message' && selfView.receiveY - selfView.sendY).toBeGreaterThan(0);
  });

  it('orders messages by vertical position; moving lifelines horizontally keeps order', () => {
    const { f, lifeline, message } = sequenceFixture();
    const a = lifeline('A', 100);
    const b = lifeline('B', 300);
    const first = message(a.viewId, b.viewId, 'synchronous', 100, 'first');
    message(b.viewId, a.viewId, 'reply', 140, 'second');
    expect(orderedMessageNames(f, f.diagramId)).toEqual(['first', 'second']);
    f.doc = apply(f.doc, { type: 'view/update', diagramId: f.diagramId, viewId: a.viewId, patch: { x: 600 } });
    expect(orderedMessageNames(f, f.diagramId)).toEqual(['first', 'second']);
    f.doc = apply(f.doc, { type: 'view/update', diagramId: f.diagramId, viewId: first.viewId, patch: { sendY: 200, receiveY: 200 } });
    expect(orderedMessageNames(f, f.diagramId)).toEqual(['second', 'first']);
  });

  it('deleting a lifeline cascades its messages and activations (semantics and views)', () => {
    const { f, lifeline, message } = sequenceFixture();
    const a = lifeline('A', 100);
    const b = lifeline('B', 300);
    const m = message(a.viewId, b.viewId, 'asynchronous', 100);
    const act = createActivationCommands(f.doc, { diagramId: f.diagramId, lifelineViewId: b.viewId, startY: 100, endY: 160, ids: f.ids });
    if (!act.ok) throw new Error(act.reason);
    f.doc = apply(f.doc, act.commands);
    f.doc = apply(f.doc, { type: 'view/remove', diagramId: f.diagramId, viewIds: [b.viewId], deleteScopedOrphans: true });
    expect(f.doc.modelElements[b.elementId]).toBeUndefined();
    expect(f.doc.modelElements[m.elementId]).toBeUndefined();
    expect(Object.values(f.doc.modelElements).some((e) => e.kind === 'activation')).toBe(false);
    expect(Object.values(f.doc.diagrams[f.diagramId]!.views).map((v) => v.kind)).toEqual(['lifeline']);
    expect(checkIntegrity(f.doc)).toEqual([]);
  });

  it('keeps operand dividers consistent when operands are added, removed or reordered', () => {
    const { f } = sequenceFixture();
    const created = createFragmentCommands(f.doc, { diagramId: f.diagramId, operator: 'alt', bounds: { x: 50, y: 100, width: 300, height: 200 }, ids: f.ids });
    if (!created.ok) throw new Error(created.reason);
    f.doc = apply(f.doc, created.commands);
    const viewId = created.createdViewIds[0]!;
    const fragment = () => {
      const v = f.doc.diagrams[f.diagramId]!.views[viewId];
      if (v?.kind !== 'fragment') throw new Error('fragment view');
      const el = f.doc.modelElements[v.elementId];
      if (el?.kind !== 'combinedFragment') throw new Error('fragment');
      return { view: v, el };
    };
    expect(fragment().el.operands.map((o) => o.guard)).toEqual(['', 'else']);
    expect(Object.values(fragment().view.operandYs)).toEqual([200]);
    f.doc = apply(f.doc, { type: 'member/add', elementId: fragment().el.id, collection: 'operands', member: { id: 'op3', guard: 'retry' } });
    expect(Object.keys(fragment().view.operandYs)).toHaveLength(2);
    f.doc = apply(f.doc, { type: 'member/delete', elementId: fragment().el.id, collection: 'operands', memberId: fragment().el.operands[0]!.id });
    expect(Object.keys(fragment().view.operandYs)).toHaveLength(1);
    expect(fragment().view.operandYs[fragment().el.operands[0]!.id]).toBeUndefined();
    const last = executeCommands(f.doc, [
      { type: 'member/delete', elementId: fragment().el.id, collection: 'operands', memberId: fragment().el.operands[0]!.id },
      { type: 'member/delete', elementId: fragment().el.id, collection: 'operands', memberId: fragment().el.operands[1]!.id },
    ]);
    expect(last.ok).toBe(false);
  });

  it('rejects self create/destroy messages', () => {
    const { f, lifeline } = sequenceFixture();
    const a = lifeline('A', 100);
    const created = createMessageCommands(f.doc, { diagramId: f.diagramId, sourceViewId: a.viewId, targetViewId: a.viewId, sort: 'destroy', y: 100, name: '', ids: f.ids });
    expect(created.ok).toBe(false);
  });
});
