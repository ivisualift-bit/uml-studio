import type { ID } from '../schemas/common';
import {
  hasFeatures,
  isRelationship,
  type ElementOf,
  type ModelElement,
  type Relationship,
} from '../schemas/elements';
import type { ProjectDocument } from '../schemas/project';
import { checkRelationshipEndpoints } from '../model/metadata';
import { parseMultiplicity } from '../notation/multiplicity';
import { endpointInfo } from '../services/queries';
import type { Severity, ValidationCode, ValidationIssue } from './types';

type Emit = (
  code: ValidationCode,
  severity: Severity,
  elementId: ID | undefined,
  params?: Record<string, string | number>,
  suffix?: string,
) => void;

interface RuleContext {
  doc: ProjectDocument;
  emit: Emit;
  elements: ModelElement[];
  relationships: Relationship[];
  outgoing: Map<ID, Relationship[]>;
  incoming: Map<ID, Relationship[]>;
}

const NAMED_KINDS = new Set<string>([
  'package',
  'class',
  'interface',
  'enumeration',
  'dataType',
  'primitiveType',
  'signal',
  'component',
  'artifact',
  'node',
  'actor',
  'useCase',
  'subject',
  'state',
  'action',
  'activityPartition',
  'lifeline',
  'stereotype',
  'metaclass',
  'informationItem',
  'interaction',
  'activity',
  'stateMachine',
  'profile',
]);

function checkGenericRules(ctx: RuleContext): void {
  const byOwnerAndName = new Map<string, ModelElement[]>();
  for (const el of ctx.elements) {
    if (NAMED_KINDS.has(el.kind) && !el.name.trim())
      ctx.emit('nameRequired', 'warning', el.id, { kind: el.kind });
    if (
      NAMED_KINDS.has(el.kind) &&
      el.name.trim() &&
      el.ownerId &&
      el.kind !== 'lifeline' &&
      el.kind !== 'action'
    ) {
      const key = `${el.ownerId}\u0000${el.kind}\u0000${el.name.trim()}`;
      const list = byOwnerAndName.get(key);
      if (list) list.push(el);
      else byOwnerAndName.set(key, [el]);
    }
  }
  for (const list of byOwnerAndName.values()) {
    if (list.length > 1)
      for (const el of list) ctx.emit('duplicateName', 'warning', el.id, { name: el.name });
  }
  for (const rel of ctx.relationships) {
    const source = ctx.doc.modelElements[rel.sourceId];
    const target = ctx.doc.modelElements[rel.targetId];
    if (!source || !target) continue;
    const problem = checkRelationshipEndpoints(rel.kind, endpointInfo(source), endpointInfo(target));
    if (problem) {
      ctx.emit('invalidEndpoints', 'error', rel.id, {
        kind: rel.kind,
        source: source.name,
        target: target.name,
        problem,
      });
    }
  }
}

function checkMultiplicity(ctx: RuleContext, elementId: ID, value: string, where: string): void {
  if (value && !parseMultiplicity(value).ok)
    ctx.emit('invalidMultiplicity', 'error', elementId, { value, where }, where);
}

function hasCycle(start: ID, next: (id: ID) => ID[]): boolean {
  const stack = [...next(start)];
  const seen = new Set<ID>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === start) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return false;
}

function checkClassRules(ctx: RuleContext): void {
  const generalizations = ctx.relationships.filter(
    (r): r is ElementOf<'generalization'> => r.kind === 'generalization',
  );
  const parents = new Map<ID, ID[]>();
  const pairCount = new Map<string, number>();
  for (const g of generalizations) {
    if (g.sourceId === g.targetId) ctx.emit('selfGeneralization', 'error', g.id);
    parents.set(g.sourceId, [...(parents.get(g.sourceId) ?? []), g.targetId]);
    const key = `${g.sourceId}>${g.targetId}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  for (const g of generalizations) {
    if ((pairCount.get(`${g.sourceId}>${g.targetId}`) ?? 0) > 1)
      ctx.emit('duplicateGeneralization', 'warning', g.id);
  }
  const cyclic = new Set<ID>();
  for (const id of parents.keys()) if (hasCycle(id, (x) => parents.get(x) ?? [])) cyclic.add(id);
  for (const id of cyclic)
    ctx.emit('inheritanceCycle', 'error', id, { name: ctx.doc.modelElements[id]?.name ?? '' });

  // Composition: whole → part edges.
  const wholes = new Map<ID, ID[]>();
  for (const rel of ctx.relationships) {
    if (rel.kind !== 'association') continue;
    checkMultiplicity(ctx, rel.id, rel.sourceEnd.multiplicity, 'source');
    checkMultiplicity(ctx, rel.id, rel.targetEnd.multiplicity, 'target');
    if (rel.sourceId === rel.targetId) continue;
    if (rel.sourceEnd.aggregation === 'composite')
      wholes.set(rel.sourceId, [...(wholes.get(rel.sourceId) ?? []), rel.targetId]);
    if (rel.targetEnd.aggregation === 'composite')
      wholes.set(rel.targetId, [...(wholes.get(rel.targetId) ?? []), rel.sourceId]);
  }
  for (const id of wholes.keys()) {
    if (hasCycle(id, (x) => wholes.get(x) ?? []))
      ctx.emit('compositionCycle', 'error', id, { name: ctx.doc.modelElements[id]?.name ?? '' });
  }

  for (const el of ctx.elements) {
    if (!hasFeatures(el)) continue;
    const names = new Map<string, number>();
    for (const a of el.attributes) {
      checkMultiplicity(ctx, el.id, a.multiplicity, `attribute:${a.id}`);
      if (a.name) names.set(a.name, (names.get(a.name) ?? 0) + 1);
    }
    for (const [name, count] of names) {
      if (count > 1) ctx.emit('duplicateAttributeName', 'warning', el.id, { name }, name);
    }
    for (const op of el.operations) {
      if (op.isAbstract && el.kind === 'class' && !el.isAbstract) {
        ctx.emit('abstractOperationInConcreteClass', 'warning', el.id, { operation: op.name }, op.id);
      }
      for (const p of op.parameters) {
        checkMultiplicity(ctx, el.id, p.multiplicity, `parameter:${p.id}`);
        if (!p.name.trim() && p.direction !== 'return')
          ctx.emit('unnamedParameter', 'warning', el.id, { operation: op.name }, p.id);
      }
    }
  }
}

function checkUseCaseRules(ctx: RuleContext): void {
  const includes = new Map<ID, ID[]>();
  for (const rel of ctx.relationships) {
    const s = ctx.doc.modelElements[rel.sourceId];
    const t = ctx.doc.modelElements[rel.targetId];
    if (rel.kind === 'association' && s?.kind === 'actor' && t?.kind === 'actor')
      ctx.emit('actorAssociation', 'warning', rel.id);
    if (rel.kind === 'include')
      includes.set(rel.sourceId, [...(includes.get(rel.sourceId) ?? []), rel.targetId]);
  }
  for (const id of includes.keys()) {
    if (hasCycle(id, (x) => includes.get(x) ?? []))
      ctx.emit('includeCycle', 'error', id, { name: ctx.doc.modelElements[id]?.name ?? '' });
  }
  for (const el of ctx.elements) {
    if (el.kind !== 'useCase') continue;
    const related = [...(ctx.outgoing.get(el.id) ?? []), ...(ctx.incoming.get(el.id) ?? [])];
    const linked = related.some((r) => {
      if (r.kind === 'include' || r.kind === 'extend' || r.kind === 'generalization') return true;
      const other = ctx.doc.modelElements[r.sourceId === el.id ? r.targetId : r.sourceId];
      return r.kind === 'association' && other?.kind === 'actor';
    });
    if (!linked) ctx.emit('useCaseWithoutActor', 'info', el.id, { name: el.name });
  }
}

function checkSequenceRules(ctx: RuleContext): void {
  for (const diagram of Object.values(ctx.doc.diagrams)) {
    if (diagram.kind !== 'sequence') continue;
    const messages = Object.values(diagram.views)
      .filter((v) => v.kind === 'message')
      .sort((a, b) => a.sendY - b.sendY || a.id.localeCompare(b.id));
    const destroyedAt = new Map<ID, number>();
    const firstMessageY = new Map<ID, number>();
    for (const view of messages) {
      const msg = ctx.doc.modelElements[view.elementId];
      if (msg?.kind !== 'message') continue;
      const emit = (code: ValidationCode, severity: Severity) => {
        const issueParams = { name: msg.name };
        ctx.emit(code, severity, msg.id, issueParams, diagram.id);
      };
      if (view.sendY < 0 || view.receiveY < 0) emit('messageNegativeY', 'error');
      if (
        (msg.sort === 'create' || msg.sort === 'destroy') &&
        msg.sourceLifelineId === msg.targetLifelineId
      ) {
        emit('selfCreateOrDestroy', 'error');
      }
      for (const lifelineId of [msg.sourceLifelineId, msg.targetLifelineId]) {
        if (!lifelineId) continue;
        const destroyed = destroyedAt.get(lifelineId);
        if (destroyed !== undefined && view.sendY > destroyed) emit('messageAfterDestroy', 'error');
      }
      if (msg.sort === 'create' && msg.targetLifelineId) {
        const earlier = firstMessageY.get(msg.targetLifelineId);
        if (earlier !== undefined && earlier < view.sendY) emit('createAfterMessages', 'warning');
      }
      for (const lifelineId of [msg.sourceLifelineId, msg.targetLifelineId]) {
        if (lifelineId && !firstMessageY.has(lifelineId)) firstMessageY.set(lifelineId, view.sendY);
      }
      if (msg.sort === 'destroy' && msg.targetLifelineId)
        destroyedAt.set(msg.targetLifelineId, view.receiveY);
    }
    for (const view of Object.values(diagram.views)) {
      if (view.kind === 'fragment') {
        const frag = ctx.doc.modelElements[view.elementId];
        if (frag?.kind !== 'combinedFragment') continue;
        let previous = view.y;
        let ordered = true;
        for (const operand of frag.operands.slice(1)) {
          const y = view.operandYs[operand.id];
          if (y === undefined || y <= previous || y >= view.y + view.height) ordered = false;
          else previous = y;
        }
        if (!ordered)
          ctx.emit('fragmentOperandOrder', 'error', frag.id, { operator: frag.operator }, diagram.id);
      }
      if (view.kind === 'activation' && view.endY <= view.startY) {
        ctx.emit('activationRange', 'error', view.elementId, {}, diagram.id);
      }
    }
  }
}

function checkActivityRules(ctx: RuleContext): void {
  const activities = ctx.elements.filter((e) => e.kind === 'activity');
  for (const activity of activities) {
    const nodes = ctx.elements.filter(
      (e) =>
        e.ownerId === activity.id &&
        (e.kind === 'action' || e.kind === 'controlNode' || e.kind === 'objectNode'),
    );
    if (nodes.length === 0) continue;
    const controls = nodes.filter((n): n is ElementOf<'controlNode'> => n.kind === 'controlNode');
    if (!controls.some((c) => c.nodeKind === 'initial'))
      ctx.emit('missingInitialNode', 'info', activity.id, { name: activity.name });
    if (!controls.some((c) => c.nodeKind === 'activityFinal' || c.nodeKind === 'flowFinal')) {
      ctx.emit('missingFinalNode', 'info', activity.id, { name: activity.name });
    }
    for (const node of nodes) {
      const out = (ctx.outgoing.get(node.id) ?? []).filter(
        (r) => r.kind === 'controlFlow' || r.kind === 'objectFlow',
      );
      const inc = (ctx.incoming.get(node.id) ?? []).filter(
        (r) => r.kind === 'controlFlow' || r.kind === 'objectFlow',
      );
      if (node.kind === 'controlNode') {
        switch (node.nodeKind) {
          case 'initial':
            if (inc.length) ctx.emit('initialHasIncoming', 'error', node.id);
            break;
          case 'activityFinal':
          case 'flowFinal':
            if (out.length) ctx.emit('finalHasOutgoing', 'error', node.id);
            break;
          case 'decision':
            if (out.length < 2) ctx.emit('decisionOutgoing', 'warning', node.id, { count: out.length });
            if (
              out.length >= 2 &&
              out.some((f) => (f.kind === 'controlFlow' || f.kind === 'objectFlow') && !f.guard.trim())
            ) {
              ctx.emit('decisionGuardMissing', 'warning', node.id);
            }
            break;
          case 'merge':
            if (inc.length < 2) ctx.emit('mergeIncoming', 'warning', node.id, { count: inc.length });
            break;
          case 'fork':
            if (out.length < 2) ctx.emit('forkOutgoing', 'warning', node.id, { count: out.length });
            break;
          case 'join':
            if (inc.length < 2) ctx.emit('joinIncoming', 'warning', node.id, { count: inc.length });
            break;
          default:
            break;
        }
      } else if (inc.length === 0 && out.length === 0) {
        ctx.emit('unconnectedActivityNode', 'info', node.id, { name: node.name });
      }
    }
  }
  for (const rel of ctx.relationships) {
    if (rel.kind !== 'objectFlow') continue;
    const s = ctx.doc.modelElements[rel.sourceId];
    const t = ctx.doc.modelElements[rel.targetId];
    if (s?.kind !== 'objectNode' && t?.kind !== 'objectNode')
      ctx.emit('objectFlowWithoutObject', 'warning', rel.id);
  }
}

function checkStateRules(ctx: RuleContext): void {
  const containers = ctx.elements.filter((e) => e.kind === 'stateMachine' || e.kind === 'state');
  for (const container of containers) {
    const vertices = ctx.elements.filter(
      (e) =>
        e.ownerId === container.id &&
        (e.kind === 'state' || e.kind === 'pseudostate' || e.kind === 'finalState'),
    );
    if (vertices.length === 0) continue;
    const initials = vertices.filter(
      (v): v is ElementOf<'pseudostate'> => v.kind === 'pseudostate' && v.pseudoKind === 'initial',
    );
    if (initials.length === 0 && container.kind === 'stateMachine') {
      ctx.emit('missingInitialState', 'info', container.id, { name: container.name });
    }
    if (initials.length > 1)
      for (const i of initials) ctx.emit('multipleInitialStates', 'warning', i.id, { name: container.name });
    for (const initial of initials) {
      const out = (ctx.outgoing.get(initial.id) ?? []).filter(
        (r): r is ElementOf<'transition'> => r.kind === 'transition',
      );
      if (out.length !== 1) ctx.emit('initialStateOutgoing', 'warning', initial.id, { count: out.length });
      for (const t of out) if (t.trigger.trim()) ctx.emit('initialTransitionTrigger', 'warning', t.id);
    }
    for (const v of vertices) {
      if (v.kind === 'finalState' && (ctx.outgoing.get(v.id) ?? []).some((r) => r.kind === 'transition')) {
        ctx.emit('finalHasOutgoing', 'error', v.id);
      }
    }
  }
  // Reachability per state machine, from its top-level initial pseudostates (entering a composite
  // state also enters its nested initial states).
  for (const machine of ctx.elements.filter((e) => e.kind === 'stateMachine')) {
    const inside = new Set<ID>();
    const stack = [machine.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const el of ctx.elements) {
        if (
          el.ownerId === id &&
          (el.kind === 'state' || el.kind === 'pseudostate' || el.kind === 'finalState')
        ) {
          inside.add(el.id);
          stack.push(el.id);
        }
      }
    }
    const roots = [...inside].filter((id) => {
      const el = ctx.doc.modelElements[id];
      return el?.kind === 'pseudostate' && el.pseudoKind === 'initial' && el.ownerId === machine.id;
    });
    if (roots.length === 0) continue;
    const reached = new Set<ID>(roots);
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift()!;
      const targets = (ctx.outgoing.get(id) ?? [])
        .filter((r) => r.kind === 'transition')
        .map((r) => r.targetId);
      const nested = ctx.elements
        .filter((e) => e.ownerId === id && e.kind === 'pseudostate' && e.pseudoKind === 'initial')
        .map((e) => e.id);
      const owner = ctx.doc.modelElements[id]?.ownerId;
      // Leaving a substate via its parent's transitions is implied: parent reached ⇒ children may exit.
      for (const next of [...targets, ...nested, ...(owner && inside.has(owner) ? [owner] : [])]) {
        if (!reached.has(next) && inside.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    for (const id of inside) {
      const el = ctx.doc.modelElements[id];
      if (!el || reached.has(id) || el.kind === 'pseudostate') continue;
      // A composite state's children are reachable if the composite is reached and has an initial.
      ctx.emit('unreachableState', 'warning', id, { name: el.name });
    }
  }
}

function checkStructureRules(ctx: RuleContext): void {
  for (const rel of ctx.relationships) {
    if (rel.kind !== 'link' || !rel.associationId) continue;
    const assoc = ctx.doc.modelElements[rel.associationId];
    const s = ctx.doc.modelElements[rel.sourceId];
    const t = ctx.doc.modelElements[rel.targetId];
    if (
      assoc?.kind !== 'association' ||
      s?.kind !== 'instanceSpecification' ||
      t?.kind !== 'instanceSpecification'
    )
      continue;
    const ends = new Set([assoc.sourceId, assoc.targetId]);
    if ((s.classifierId && !ends.has(s.classifierId)) || (t.classifierId && !ends.has(t.classifierId))) {
      ctx.emit('linkClassifierMismatch', 'warning', rel.id);
    }
  }
}

export function validateProject(doc: ProjectDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const emit: Emit = (code, severity, elementId, params = {}, suffix) => {
    const id = [code, elementId ?? '-', suffix ?? ''].join(':');
    if (seen.has(id)) return;
    seen.add(id);
    const diagramId = suffix && doc.diagrams[suffix] ? suffix : undefined;
    issues.push({ id, code, severity, elementId, diagramId, params });
  };
  const elements = Object.values(doc.modelElements);
  const relationships = elements.filter(isRelationship);
  const outgoing = new Map<ID, Relationship[]>();
  const incoming = new Map<ID, Relationship[]>();
  for (const rel of relationships) {
    outgoing.set(rel.sourceId, [...(outgoing.get(rel.sourceId) ?? []), rel]);
    incoming.set(rel.targetId, [...(incoming.get(rel.targetId) ?? []), rel]);
  }
  const ctx: RuleContext = { doc, emit, elements, relationships, outgoing, incoming };
  checkGenericRules(ctx);
  checkClassRules(ctx);
  checkUseCaseRules(ctx);
  checkSequenceRules(ctx);
  checkActivityRules(ctx);
  checkStateRules(ctx);
  checkStructureRules(ctx);
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
}
