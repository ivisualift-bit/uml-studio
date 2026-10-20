import { describe, expect, it } from 'vitest';
import { validateProject } from '@/domain/validation/rules';
import { createLifelineCommands, createMessageCommands } from '@/domain/commands/creators';
import { executeCommands } from '@/domain/commands/engine';
import { makeElement } from '@/domain/model/factory';
import { addNode, apply, connect, withDiagram } from '../helpers';

const codes = (doc: Parameters<typeof validateProject>[0]) => validateProject(doc).map((i) => i.code);

describe('class rules', () => {
  it('reports inheritance cycles, invalid multiplicities and abstract operations in concrete classes', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'A' });
    const b = addNode(f, f.diagramId, { kind: 'class', name: 'B' }, 300);
    connect(f, f.diagramId, 'generalization', a.viewId, b.viewId);
    connect(f, f.diagramId, 'generalization', b.viewId, a.viewId);
    const assoc = connect(f, f.diagramId, 'association', a.viewId, b.viewId);
    f.doc = apply(f.doc, { type: 'element/update', elementId: assoc.relationshipId, patch: { sourceEnd: { ...(f.doc.modelElements[assoc.relationshipId] as { sourceEnd: object }).sourceEnd, multiplicity: '3..1' } } });
    f.doc = apply(f.doc, { type: 'member/add', elementId: a.elementId, collection: 'operations', member: { id: 'op', name: 'run', isAbstract: true } });
    const found = codes(f.doc);
    expect(found).toContain('inheritanceCycle');
    expect(found).toContain('invalidMultiplicity');
    expect(found).toContain('abstractOperationInConcreteClass');
  });

  it('reports composition cycles', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'A' });
    const b = addNode(f, f.diagramId, { kind: 'class', name: 'B' }, 300);
    connect(f, f.diagramId, 'composition', a.viewId, b.viewId);
    connect(f, f.diagramId, 'composition', b.viewId, a.viewId);
    expect(codes(f.doc)).toContain('compositionCycle');
  });

  it('reports incompatible endpoints present in imported data', () => {
    const f = withDiagram('class');
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'A' });
    const i = addNode(f, f.diagramId, { kind: 'interface', name: 'I' }, 300);
    const outcome = executeCommands(f.doc, [
      {
        type: 'element/add',
        elements: [makeElement('generalization', { id: 'g', name: '', ownerId: a.elementId, sourceId: a.elementId, targetId: i.elementId })],
      },
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(codes(outcome.doc)).toContain('invalidEndpoints');
  });
});

describe('use case rules', () => {
  it('reports use cases without actors and actor-actor associations', () => {
    const f = withDiagram('useCase');
    addNode(f, f.diagramId, { kind: 'useCase', name: 'Orphan' });
    const a1 = addNode(f, f.diagramId, { kind: 'actor', name: 'A' }, 300);
    const a2 = addNode(f, f.diagramId, { kind: 'actor', name: 'B' }, 500);
    connect(f, f.diagramId, 'association', a1.viewId, a2.viewId);
    const found = codes(f.doc);
    expect(found).toContain('useCaseWithoutActor');
    expect(found).toContain('actorAssociation');
  });
});

describe('activity rules', () => {
  it('reports decisions without guards and missing final nodes', () => {
    const f = withDiagram('activity');
    const init = addNode(f, f.diagramId, { kind: 'controlNode', subKind: 'initial' });
    const decision = addNode(f, f.diagramId, { kind: 'controlNode', subKind: 'decision' }, 0, 100);
    const a = addNode(f, f.diagramId, { kind: 'action', name: 'Approve' }, -100, 200);
    const b = addNode(f, f.diagramId, { kind: 'action', name: 'Reject' }, 100, 200);
    connect(f, f.diagramId, 'controlFlow', init.viewId, decision.viewId);
    const flow = connect(f, f.diagramId, 'controlFlow', decision.viewId, a.viewId);
    connect(f, f.diagramId, 'controlFlow', decision.viewId, b.viewId);
    f.doc = apply(f.doc, { type: 'element/update', elementId: flow.relationshipId, patch: { guard: 'ok' } });
    const found = codes(f.doc);
    expect(found).toContain('decisionGuardMissing');
    expect(found).toContain('missingFinalNode');
    expect(found).not.toContain('missingInitialNode');
  });
});

describe('state machine rules', () => {
  it('reports unreachable states and triggers on initial transitions', () => {
    const f = withDiagram('stateMachine');
    const init = addNode(f, f.diagramId, { kind: 'pseudostate', subKind: 'initial' });
    const draft = addNode(f, f.diagramId, { kind: 'state', name: 'Draft' }, 200);
    addNode(f, f.diagramId, { kind: 'state', name: 'Island' }, 400);
    const t = connect(f, f.diagramId, 'transition', init.viewId, draft.viewId);
    f.doc = apply(f.doc, { type: 'element/update', elementId: t.relationshipId, patch: { trigger: 'start' } });
    const issues = validateProject(f.doc);
    expect(issues.find((i) => i.code === 'unreachableState')?.params).toMatchObject({ name: 'Island' });
    expect(issues.map((i) => i.code)).toContain('initialTransitionTrigger');
    expect(issues.find((i) => i.params.name === 'Draft' && i.code === 'unreachableState')).toBeUndefined();
  });
});

describe('sequence rules', () => {
  it('reports messages after a destroy', () => {
    const f = withDiagram('sequence');
    const ll = (name: string, x: number) => {
      const c = createLifelineCommands(f.doc, { diagramId: f.diagramId, x, baseName: 'L', headStyle: 'object', name, ids: f.ids });
      if (!c.ok) throw new Error(c.reason);
      f.doc = apply(f.doc, c.commands);
      return c.viewId!;
    };
    const msg = (from: string, to: string, sort: 'destroy' | 'synchronous', y: number) => {
      const c = createMessageCommands(f.doc, { diagramId: f.diagramId, sourceViewId: from, targetViewId: to, sort, y, name: 'm', ids: f.ids });
      if (!c.ok) throw new Error(c.reason);
      f.doc = apply(f.doc, c.commands);
    };
    const a = ll('A', 100);
    const b = ll('B', 300);
    msg(a, b, 'destroy', 100);
    msg(a, b, 'synchronous', 150);
    expect(codes(f.doc)).toContain('messageAfterDestroy');
  });
});

describe('issue identity', () => {
  it('produces deterministic, sorted issues', () => {
    const f = withDiagram('useCase');
    addNode(f, f.diagramId, { kind: 'useCase', name: 'X' });
    expect(validateProject(f.doc)).toEqual(validateProject(f.doc));
  });
});
