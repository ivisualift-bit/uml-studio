import { current, isDraft } from 'immer';
import type * as z from 'zod';
import type { ID } from '../schemas/common';
import { hasFeatures, isRelationship, type ModelElement } from '../schemas/elements';
import {
  AppliedStereotypeSchema,
  AttributeSchema,
  CommunicationMessageSchema,
  EnumerationLiteralSchema,
  ExtensionPointSchema,
  InteractionOperandSchema,
  OperationSchema,
  ParameterSchema,
  SlotSchema,
  TagDefinitionSchema,
} from '../schemas/members';
import type { ProjectDocument, UMLDiagram } from '../schemas/project';
import { canOwn, checkRelationshipEndpoints, DIAGRAM_SCOPED_KINDS } from '../model/metadata';
import { applyContainment, visualDescendants } from '../services/containment';
import {
  applyDeletionPlan,
  collectDependentViews,
  planElementDeletion,
  removeViewsFromDiagram,
} from '../services/deletion';
import { ancestorIds, endpointInfo } from '../services/queries';
import { clamp } from '../util';
import type { Transaction } from './transaction';
import { CommandError, type Command, type FieldPatch, type MemberCollection } from './types';

/** Non-draft snapshot for read-only services that memoise by object identity. */
function snap(draft: ProjectDocument): ProjectDocument {
  return isDraft(draft) ? current(draft) : draft;
}

function requireElement(draft: ProjectDocument, id: ID): ModelElement {
  const el = draft.modelElements[id];
  if (!el) throw new CommandError('notFound', `Element ${id} not found`);
  return el;
}

function requireDiagram(draft: ProjectDocument, id: ID): UMLDiagram {
  const diagram = draft.diagrams[id];
  if (!diagram) throw new CommandError('notFound', `Diagram ${id} not found`);
  return diagram;
}

function assertFreshId(draft: ProjectDocument, id: ID): void {
  if (draft.modelElements[id] || draft.diagrams[id])
    throw new CommandError('duplicateId', `Identifier ${id} already exists`);
}

/** Apply a shallow patch; `undefined` deletes optional keys. Immutable keys are rejected. */
function applyPatch(target: Record<string, unknown>, patch: FieldPatch, immutable: readonly string[]): void {
  for (const [key, value] of Object.entries(patch)) {
    if (immutable.includes(key))
      throw new CommandError('immutableField', `Field "${key}" cannot be changed with this command`);
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}

const ELEMENT_IMMUTABLE = [
  'id',
  'kind',
  'ownerId',
  'sourceId',
  'targetId',
  'sourceLifelineId',
  'targetLifelineId',
  'lifelineId',
];
const VIEW_IMMUTABLE = ['id', 'kind', 'elementId', 'sourceViewId', 'targetViewId', 'lifelineViewId'];

// -------------------------------------------------------------------------------------------------
// Members
// -------------------------------------------------------------------------------------------------

const MEMBER_SCHEMAS: Record<MemberCollection, z.ZodType<{ id: ID }>> = {
  attributes: AttributeSchema,
  operations: OperationSchema,
  parameters: ParameterSchema,
  literals: EnumerationLiteralSchema,
  extensionPoints: ExtensionPointSchema,
  operands: InteractionOperandSchema,
  slots: SlotSchema,
  tagDefinitions: TagDefinitionSchema,
  messages: CommunicationMessageSchema,
  appliedStereotypes: AppliedStereotypeSchema,
};

function memberList(el: ModelElement, collection: MemberCollection, operationId?: ID): Array<{ id: ID }> {
  const fail = (): never => {
    throw new CommandError('invalidPayload', `A ${el.kind} has no "${collection}" collection`);
  };
  switch (collection) {
    case 'attributes':
      return hasFeatures(el) ? el.attributes : fail();
    case 'operations':
      return hasFeatures(el) ? el.operations : fail();
    case 'parameters': {
      if (!hasFeatures(el)) return fail();
      const op = el.operations.find((o) => o.id === operationId);
      if (!op) throw new CommandError('notFound', `Operation ${operationId ?? '?'} not found`);
      return op.parameters;
    }
    case 'literals':
      return el.kind === 'enumeration' ? el.literals : fail();
    case 'extensionPoints':
      return el.kind === 'useCase' ? el.extensionPoints : fail();
    case 'operands':
      return el.kind === 'combinedFragment' ? el.operands : fail();
    case 'slots':
      return el.kind === 'instanceSpecification' ? el.slots : fail();
    case 'tagDefinitions':
      return el.kind === 'stereotype' ? el.tagDefinitions : fail();
    case 'messages':
      return el.kind === 'connector' ? el.messages : fail();
    case 'appliedStereotypes':
      return el.appliedStereotypes;
    default:
      return fail();
  }
}

function fragmentViewsOf(draft: ProjectDocument, fragmentId: ID) {
  const result = [];
  for (const diagram of Object.values(draft.diagrams)) {
    for (const view of Object.values(diagram.views)) {
      if (view.kind === 'fragment' && view.elementId === fragmentId) result.push({ diagram, view });
    }
  }
  return result;
}

function addMember(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'member/add' }>,
  tx: Transaction,
): void {
  const el = requireElement(draft, cmd.elementId);
  const list = memberList(el, cmd.collection, cmd.operationId);
  const parsed = MEMBER_SCHEMAS[cmd.collection].safeParse(cmd.member);
  if (!parsed.success)
    throw new CommandError(
      'schema',
      'Invalid member',
      parsed.error.issues.map((i) => i.message),
    );
  if (list.some((m) => m.id === parsed.data.id))
    throw new CommandError('duplicateId', `Member ${parsed.data.id} exists`);
  const index = cmd.index === undefined ? list.length : clamp(cmd.index, 0, list.length);
  list.splice(index, 0, parsed.data);
  tx.touchElement(el.id);
  if (cmd.collection === 'operands' && el.kind === 'combinedFragment') {
    // Give each fragment view a divider for the new operand inside the last operand's band.
    for (const { diagram, view } of fragmentViewsOf(draft, el.id)) {
      const tops = el.operands
        .slice(1)
        .map((o) => view.operandYs[o.id])
        .filter((y): y is number => typeof y === 'number');
      const bottom = view.y + view.height;
      const lastTop = Math.max(view.y + 24, ...tops);
      for (const operand of el.operands.slice(1)) {
        if (view.operandYs[operand.id] === undefined) {
          view.operandYs[operand.id] = Math.round(lastTop + (bottom - lastTop) / 2);
        }
      }
      tx.touchView(diagram.id, view.id);
    }
  }
}

function updateMember(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'member/update' }>,
  tx: Transaction,
): void {
  const el = requireElement(draft, cmd.elementId);
  const list = memberList(el, cmd.collection, cmd.operationId);
  const member = list.find((m) => m.id === cmd.memberId);
  if (!member) throw new CommandError('notFound', `Member ${cmd.memberId} not found`);
  applyPatch(member as unknown as Record<string, unknown>, cmd.patch, ['id']);
  tx.touchElement(el.id);
}

function deleteMember(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'member/delete' }>,
  tx: Transaction,
): void {
  const el = requireElement(draft, cmd.elementId);
  const list = memberList(el, cmd.collection, cmd.operationId);
  const index = list.findIndex((m) => m.id === cmd.memberId);
  if (index < 0) throw new CommandError('notFound', `Member ${cmd.memberId} not found`);
  if (cmd.collection === 'operands' && list.length <= 1) {
    throw new CommandError('invalidPayload', 'A combined fragment needs at least one operand');
  }
  list.splice(index, 1);
  tx.touchElement(el.id);
  if (cmd.collection === 'operands') {
    for (const { diagram, view } of fragmentViewsOf(draft, el.id)) {
      delete view.operandYs[cmd.memberId];
      // The new first operand has no divider.
      if (el.kind === 'combinedFragment' && el.operands[0]) delete view.operandYs[el.operands[0].id];
      tx.touchView(diagram.id, view.id);
    }
  }
  if (cmd.collection === 'attributes') {
    for (const other of Object.values(draft.modelElements)) {
      if (other.kind !== 'instanceSpecification') continue;
      for (const slot of other.slots) {
        if (slot.definingFeatureId === cmd.memberId) {
          slot.definingFeatureId = null;
          tx.touchElement(other.id);
        }
      }
    }
  }
  if (cmd.collection === 'extensionPoints') {
    for (const other of Object.values(draft.modelElements)) {
      if (other.kind === 'extend' && other.extensionPointIds.includes(cmd.memberId)) {
        other.extensionPointIds = other.extensionPointIds.filter((id) => id !== cmd.memberId);
        tx.touchElement(other.id);
      }
    }
  }
}

function moveMember(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'member/move' }>,
  tx: Transaction,
): void {
  const el = requireElement(draft, cmd.elementId);
  const list = memberList(el, cmd.collection, cmd.operationId);
  const index = list.findIndex((m) => m.id === cmd.memberId);
  if (index < 0) throw new CommandError('notFound', `Member ${cmd.memberId} not found`);
  const target = clamp(cmd.toIndex, 0, list.length - 1);
  if (target === index) return;
  const [member] = list.splice(index, 1);
  list.splice(target, 0, member!);
  tx.touchElement(el.id);
  if (cmd.collection === 'operands' && el.kind === 'combinedFragment') {
    // Dividers belong to positions, not operands: re-key them by the new order.
    for (const { diagram, view } of fragmentViewsOf(draft, el.id)) {
      const ys = Object.values(view.operandYs).sort((a, b) => a - b);
      view.operandYs = {};
      el.operands.slice(1).forEach((operand, i) => {
        const y = ys[i];
        if (y !== undefined) view.operandYs[operand.id] = y;
      });
      tx.touchView(diagram.id, view.id);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Elements
// -------------------------------------------------------------------------------------------------

function addElements(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'element/add' }>,
  tx: Transaction,
): void {
  for (const el of cmd.elements) {
    assertFreshId(draft, el.id);
    draft.modelElements[el.id] = el;
    tx.touchElement(el.id);
  }
  if (cmd.views?.length) {
    if (!cmd.diagramId) throw new CommandError('invalidPayload', 'Views require a diagram');
    addViews(draft, { type: 'view/add', diagramId: cmd.diagramId, views: cmd.views }, tx);
  }
}

function moveElement(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'element/move' }>,
  tx: Transaction,
): void {
  const el = requireElement(draft, cmd.elementId);
  if (el.id === draft.rootModelId) throw new CommandError('rootProtected', 'The root model cannot be moved');
  const owner = requireElement(draft, cmd.newOwnerId);
  if (!canOwn(owner.kind, el.kind))
    throw new CommandError('ownershipNotAllowed', `A ${owner.kind} cannot own a ${el.kind}`);
  if (owner.id === el.id || ancestorIds(snap(draft), owner.id).includes(el.id)) {
    throw new CommandError('ownershipCycle', 'An element cannot be moved into itself');
  }
  el.ownerId = owner.id;
  tx.touchElement(el.id);
}

function deleteElements(draft: ProjectDocument, ids: readonly ID[], tx: Transaction): void {
  if (ids.includes(draft.rootModelId))
    throw new CommandError('rootProtected', 'The root model cannot be deleted');
  for (const id of ids) requireElement(draft, id);
  const plan = planElementDeletion(snap(draft), ids);
  applyDeletionPlan(draft, plan);
  for (const id of plan.elementIds) tx.touchElement(id);
  for (const id of plan.diagramIds) tx.touchDiagram(id);
  for (const diagramId of plan.viewsByDiagram.keys()) tx.touchDiagram(diagramId);
}

function reconnect(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'element/reconnect' }>,
  tx: Transaction,
): void {
  const rel = requireElement(draft, cmd.relationshipId);
  if (!isRelationship(rel)) throw new CommandError('invalidPayload', 'Only relationships can be reconnected');
  const newEnd = requireElement(draft, cmd.newElementId);
  const source = cmd.end === 'source' ? newEnd : requireElement(draft, rel.sourceId);
  const target = cmd.end === 'target' ? newEnd : requireElement(draft, rel.targetId);
  const problem = checkRelationshipEndpoints(rel.kind, endpointInfo(source), endpointInfo(target));
  if (problem) throw new CommandError('endpointNotAllowed', `Cannot connect: ${problem}`, [problem]);
  if (cmd.end === 'source') {
    rel.sourceId = newEnd.id;
    rel.ownerId = newEnd.id;
  } else {
    rel.targetId = newEnd.id;
    if (rel.kind === 'extend') rel.extensionPointIds = [];
  }
  tx.touchElement(rel.id);
  const updated = new Set<string>();
  for (const u of cmd.edgeUpdates) {
    const diagram = requireDiagram(draft, u.diagramId);
    const edge = diagram.views[u.edgeViewId];
    const node = diagram.views[u.nodeViewId];
    if (edge?.kind !== 'edge' || node?.kind !== 'node' || node.elementId !== newEnd.id) {
      throw new CommandError('invalidPayload', 'Edge update does not match the new endpoint');
    }
    if (cmd.end === 'source') edge.sourceViewId = node.id;
    else edge.targetViewId = node.id;
    edge.waypoints = [];
    updated.add(`${diagram.id}/${edge.id}`);
    tx.touchView(diagram.id, edge.id);
  }
  // Other diagrams may not show the new endpoint: drop their (now inconsistent) edge views.
  for (const diagram of Object.values(draft.diagrams)) {
    for (const view of Object.values(diagram.views)) {
      if (view.kind === 'edge' && view.elementId === rel.id && !updated.has(`${diagram.id}/${view.id}`)) {
        const endView = diagram.views[cmd.end === 'source' ? view.sourceViewId : view.targetViewId];
        if (endView?.kind === 'node' && endView.elementId === newEnd.id) continue;
        delete diagram.views[view.id];
        tx.touchDiagram(diagram.id);
      }
    }
  }
}

function swapEnds(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'element/swapEnds' }>,
  tx: Transaction,
): void {
  const rel = requireElement(draft, cmd.relationshipId);
  if (!isRelationship(rel)) throw new CommandError('invalidPayload', 'Only relationships can be reversed');
  const source = requireElement(draft, rel.sourceId);
  const target = requireElement(draft, rel.targetId);
  const problem = checkRelationshipEndpoints(rel.kind, endpointInfo(target), endpointInfo(source));
  if (problem) throw new CommandError('endpointNotAllowed', `Cannot reverse: ${problem}`, [problem]);
  [rel.sourceId, rel.targetId] = [rel.targetId, rel.sourceId];
  rel.ownerId = rel.sourceId;
  if ('sourceEnd' in rel) [rel.sourceEnd, rel.targetEnd] = [rel.targetEnd, rel.sourceEnd];
  if (rel.kind === 'extend') rel.extensionPointIds = [];
  tx.touchElement(rel.id);
  const swapKey: Record<string, string> = {
    sourceRole: 'targetRole',
    targetRole: 'sourceRole',
    sourceMultiplicity: 'targetMultiplicity',
    targetMultiplicity: 'sourceMultiplicity',
  };
  for (const diagram of Object.values(draft.diagrams)) {
    for (const view of Object.values(diagram.views)) {
      if (view.kind !== 'edge' || view.elementId !== rel.id) continue;
      [view.sourceViewId, view.targetViewId] = [view.targetViewId, view.sourceViewId];
      view.waypoints = view.waypoints.slice().reverse();
      view.labelOffsets = Object.fromEntries(
        Object.entries(view.labelOffsets).map(([k, v]) => [swapKey[k] ?? k, v]),
      );
      tx.touchView(diagram.id, view.id);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Views
// -------------------------------------------------------------------------------------------------

function addViews(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/add' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  for (const view of cmd.views) {
    if (diagram.views[view.id]) throw new CommandError('duplicateId', `View ${view.id} exists`);
    if ('elementId' in view && !draft.modelElements[view.elementId]) {
      throw new CommandError('notFound', `Element ${view.elementId} not found`);
    }
    diagram.views[view.id] = view;
    tx.touchView(diagram.id, view.id);
  }
  applyContainment(
    draft,
    diagram.id,
    cmd.views.filter((v) => v.kind === 'node' || v.kind === 'note').map((v) => v.id),
    tx,
  );
}

function removeViews(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/remove' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  const explicit = cmd.viewIds.filter((id) => diagram.views[id]);
  const removed = collectDependentViews(diagram, explicit);
  const scopedCandidates = new Set<ID>();
  if (cmd.deleteScopedOrphans) {
    for (const id of explicit) {
      const view = diagram.views[id];
      if (!view || !('elementId' in view)) continue;
      const el = draft.modelElements[view.elementId];
      if (el && DIAGRAM_SCOPED_KINDS.has(el.kind)) scopedCandidates.add(el.id);
    }
  }
  removeViewsFromDiagram(diagram, removed);
  tx.touchDiagram(diagram.id);
  if (scopedCandidates.size === 0) return;
  // Delete scoped semantics that are no longer represented anywhere.
  const stillShown = new Set<ID>();
  for (const d of Object.values(draft.diagrams)) {
    for (const v of Object.values(d.views))
      if ('elementId' in v && scopedCandidates.has(v.elementId)) stillShown.add(v.elementId);
  }
  const orphans = [...scopedCandidates].filter((id) => !stillShown.has(id));
  if (orphans.length) deleteElements(draft, orphans, tx);
}

function moveViews(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/move' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  if (!Number.isFinite(cmd.dx) || !Number.isFinite(cmd.dy))
    throw new CommandError('invalidPayload', 'Invalid move delta');
  if (cmd.dx === 0 && cmd.dy === 0) return;
  const moved = new Set<ID>();
  for (const id of cmd.viewIds) {
    const view = diagram.views[id];
    if (!view || (view.kind !== 'node' && view.kind !== 'note')) continue;
    moved.add(id);
    for (const d of visualDescendants(diagram, id)) moved.add(d);
  }
  for (const id of moved) {
    const view = diagram.views[id];
    if (view && (view.kind === 'node' || view.kind === 'note')) {
      view.x = clamp(view.x + cmd.dx, -1_000_000, 1_000_000);
      view.y = clamp(view.y + cmd.dy, -1_000_000, 1_000_000);
      tx.touchView(diagram.id, id);
    }
  }
  for (const view of Object.values(diagram.views)) {
    if (
      (view.kind === 'edge' || view.kind === 'noteLink') &&
      moved.has(view.sourceViewId) &&
      moved.has(view.targetViewId)
    ) {
      if (view.waypoints.length) {
        view.waypoints = view.waypoints.map((p) => ({ x: p.x + cmd.dx, y: p.y + cmd.dy }));
        tx.touchView(diagram.id, view.id);
      }
    }
  }
  const topLevel = [...moved].filter((id) => {
    const v = diagram.views[id];
    return (
      v && (v.kind === 'node' || v.kind === 'note') && !(v.containerViewId && moved.has(v.containerViewId))
    );
  });
  applyContainment(draft, diagram.id, topLevel, tx);
}

function containmentCandidatesAround(diagram: UMLDiagram, viewId: ID): ID[] {
  const container = diagram.views[viewId];
  if (!container || container.kind !== 'node') return [viewId];
  const ids = [viewId];
  for (const v of Object.values(diagram.views)) {
    if (v.kind !== 'node' && v.kind !== 'note') continue;
    if (v.id === viewId) continue;
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2;
    const inside =
      cx >= container.x &&
      cx <= container.x + container.width &&
      cy >= container.y &&
      cy <= container.y + container.height;
    if (inside || v.containerViewId === viewId) ids.push(v.id);
  }
  return ids;
}

function updateView(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/update' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  const view = diagram.views[cmd.viewId];
  if (!view) throw new CommandError('notFound', `View ${cmd.viewId} not found`);
  applyPatch(view as unknown as Record<string, unknown>, cmd.patch, VIEW_IMMUTABLE);
  tx.touchView(diagram.id, view.id);
  if (cmd.recomputeContainment && (view.kind === 'node' || view.kind === 'note')) {
    applyContainment(draft, diagram.id, containmentCandidatesAround(diagram, view.id), tx);
  }
}

function updateManyViews(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/updateMany' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  const boxes: ID[] = [];
  for (const [viewId, patch] of Object.entries(cmd.patches)) {
    const view = diagram.views[viewId];
    if (!view) throw new CommandError('notFound', `View ${viewId} not found`);
    applyPatch(view as unknown as Record<string, unknown>, patch, VIEW_IMMUTABLE);
    tx.touchView(diagram.id, view.id);
    if ((view.kind === 'node' || view.kind === 'note') && ('x' in patch || 'y' in patch)) boxes.push(view.id);
  }
  if (boxes.length) applyContainment(draft, diagram.id, boxes, tx);
}

function reorderViews(
  draft: ProjectDocument,
  cmd: Extract<Command, { type: 'view/reorder' }>,
  tx: Transaction,
): void {
  const diagram = requireDiagram(draft, cmd.diagramId);
  const selected = new Set(cmd.viewIds.filter((id) => diagram.views[id]));
  if (!selected.size) return;
  const entries = Object.entries(diagram.views);
  const picked = entries.filter(([id]) => selected.has(id));
  const rest = entries.filter(([id]) => !selected.has(id));
  diagram.views = Object.fromEntries(cmd.position === 'front' ? [...rest, ...picked] : [...picked, ...rest]);
  tx.touchDiagram(diagram.id);
}

// -------------------------------------------------------------------------------------------------
// Dispatcher
// -------------------------------------------------------------------------------------------------

export function applyCommand(draft: ProjectDocument, cmd: Command, tx: Transaction): void {
  switch (cmd.type) {
    case 'project/rename':
      draft.name = cmd.name;
      tx.touchProject();
      return;
    case 'project/update':
      if (cmd.description !== undefined) draft.description = cmd.description;
      if (cmd.settings) draft.settings = { ...draft.settings, ...cmd.settings };
      tx.touchProject();
      return;
    case 'diagram/add':
      assertFreshId(draft, cmd.diagram.id);
      for (const el of cmd.elements ?? []) {
        assertFreshId(draft, el.id);
        draft.modelElements[el.id] = el;
        tx.touchElement(el.id);
      }
      draft.diagrams[cmd.diagram.id] = cmd.diagram;
      tx.touchDiagram(cmd.diagram.id);
      for (const view of Object.values(cmd.diagram.views)) tx.touchView(cmd.diagram.id, view.id);
      return;
    case 'diagram/rename':
      requireDiagram(draft, cmd.diagramId).name = cmd.name;
      tx.touchDiagram(cmd.diagramId);
      return;
    case 'diagram/update': {
      const diagram = requireDiagram(draft, cmd.diagramId);
      if (cmd.documentation !== undefined) diagram.documentation = cmd.documentation;
      if (cmd.options) diagram.options = { ...diagram.options, ...cmd.options };
      tx.touchDiagram(diagram.id);
      return;
    }
    case 'diagram/delete':
      requireDiagram(draft, cmd.diagramId);
      delete draft.diagrams[cmd.diagramId];
      tx.touchDiagram(cmd.diagramId);
      return;
    case 'diagram/setViewport':
      requireDiagram(draft, cmd.diagramId).viewport = cmd.viewport;
      tx.touchDiagram(cmd.diagramId);
      return;
    case 'element/add':
      addElements(draft, cmd, tx);
      return;
    case 'element/update': {
      const el = requireElement(draft, cmd.elementId);
      applyPatch(el as unknown as Record<string, unknown>, cmd.patch, ELEMENT_IMMUTABLE);
      tx.touchElement(el.id);
      return;
    }
    case 'element/move':
      moveElement(draft, cmd, tx);
      return;
    case 'element/delete':
      deleteElements(draft, cmd.elementIds, tx);
      return;
    case 'element/reconnect':
      reconnect(draft, cmd, tx);
      return;
    case 'element/swapEnds':
      swapEnds(draft, cmd, tx);
      return;
    case 'member/add':
      addMember(draft, cmd, tx);
      return;
    case 'member/update':
      updateMember(draft, cmd, tx);
      return;
    case 'member/delete':
      deleteMember(draft, cmd, tx);
      return;
    case 'member/move':
      moveMember(draft, cmd, tx);
      return;
    case 'view/add':
      addViews(draft, cmd, tx);
      return;
    case 'view/remove':
      removeViews(draft, cmd, tx);
      return;
    case 'view/move':
      moveViews(draft, cmd, tx);
      return;
    case 'view/update':
      updateView(draft, cmd, tx);
      return;
    case 'view/updateMany':
      updateManyViews(draft, cmd, tx);
      return;
    case 'view/reorder':
      reorderViews(draft, cmd, tx);
      return;
    default: {
      const exhaustive: never = cmd;
      throw new CommandError('invalidPayload', `Unknown command ${(exhaustive as { type: string }).type}`);
    }
  }
}
