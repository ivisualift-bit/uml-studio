import type { ID } from '../schemas/common';
import { isRelationship } from '../schemas/elements';
import type { ProjectDocument, UMLDiagram } from '../schemas/project';
import { collectMemberIds, collectReferences, clearReferencesTo } from '../model/references';
import { descendantIds } from './queries';

export interface DeletionPlan {
  /** Every element removed (requested + owned descendants + cascading dependents). */
  elementIds: Set<ID>;
  /** Diagrams removed because their owner is removed. */
  diagramIds: Set<ID>;
  /** Views removed from surviving diagrams. */
  viewsByDiagram: Map<ID, Set<ID>>;
  relationshipIds: Set<ID>;
}

/** Reverse index target → elements holding a `cascade` reference to it. */
function cascadeIndex(doc: ProjectDocument): Map<ID, ID[]> {
  const index = new Map<ID, ID[]>();
  for (const el of Object.values(doc.modelElements)) {
    for (const ref of collectReferences(el)) {
      if (ref.policy !== 'cascade') continue;
      const list = index.get(ref.targetId);
      if (list) list.push(el.id);
      else index.set(ref.targetId, [el.id]);
    }
  }
  return index;
}

export function planElementDeletion(doc: ProjectDocument, requested: readonly ID[]): DeletionPlan {
  const elementIds = new Set<ID>();
  const cascade = cascadeIndex(doc);
  const queue: ID[] = requested.filter((id) => doc.modelElements[id] && id !== doc.rootModelId);
  while (queue.length) {
    const id = queue.pop()!;
    if (elementIds.has(id)) continue;
    elementIds.add(id);
    for (const child of descendantIds(doc, id)) if (!elementIds.has(child)) queue.push(child);
    for (const dependent of cascade.get(id) ?? []) if (!elementIds.has(dependent)) queue.push(dependent);
  }

  const relationshipIds = new Set<ID>();
  for (const id of elementIds) {
    const el = doc.modelElements[id];
    if (el && isRelationship(el)) relationshipIds.add(id);
  }

  const diagramIds = new Set<ID>();
  for (const diagram of Object.values(doc.diagrams)) {
    if (elementIds.has(diagram.ownerId)) diagramIds.add(diagram.id);
  }

  const viewsByDiagram = new Map<ID, Set<ID>>();
  for (const diagram of Object.values(doc.diagrams)) {
    if (diagramIds.has(diagram.id)) continue;
    const direct = Object.values(diagram.views)
      .filter((v) => 'elementId' in v && elementIds.has(v.elementId))
      .map((v) => v.id);
    if (direct.length === 0) continue;
    viewsByDiagram.set(diagram.id, collectDependentViews(diagram, direct));
  }
  return { elementIds, diagramIds, viewsByDiagram, relationshipIds };
}

/**
 * Views that must disappear together with `viewIds`: edges and note links attached to removed nodes,
 * messages and activations attached to removed lifelines (closure).
 */
export function collectDependentViews(diagram: UMLDiagram, viewIds: readonly ID[]): Set<ID> {
  const removed = new Set<ID>(viewIds.filter((id) => diagram.views[id]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const view of Object.values(diagram.views)) {
      if (removed.has(view.id)) continue;
      let dependent = false;
      switch (view.kind) {
        case 'edge':
        case 'noteLink':
          dependent = removed.has(view.sourceViewId) || removed.has(view.targetViewId);
          break;
        case 'message':
          dependent =
            (view.sourceViewId !== null && removed.has(view.sourceViewId)) ||
            (view.targetViewId !== null && removed.has(view.targetViewId));
          break;
        case 'activation':
          dependent = removed.has(view.lifelineViewId);
          break;
        default:
          break;
      }
      if (dependent) {
        removed.add(view.id);
        changed = true;
      }
    }
  }
  return removed;
}

/** Remove views from a (draft) diagram, re-parenting visual children of removed containers. */
export function removeViewsFromDiagram(diagram: UMLDiagram, removed: ReadonlySet<ID>): void {
  const survivingContainer = (id: ID | null): ID | null => {
    let current = id;
    const seen = new Set<ID>();
    while (current && removed.has(current) && !seen.has(current)) {
      seen.add(current);
      const v = diagram.views[current];
      current = v && (v.kind === 'node' || v.kind === 'note') ? v.containerViewId : null;
    }
    return current && removed.has(current) ? null : current;
  };
  for (const view of Object.values(diagram.views)) {
    if (removed.has(view.id)) continue;
    if (
      (view.kind === 'node' || view.kind === 'note') &&
      view.containerViewId &&
      removed.has(view.containerViewId)
    ) {
      view.containerViewId = survivingContainer(view.containerViewId);
    }
  }
  for (const id of removed) delete diagram.views[id];
}

/** Apply a deletion plan to a draft document. */
export function applyDeletionPlan(draft: ProjectDocument, plan: DeletionPlan): void {
  const removedMemberIds = new Set<ID>();
  for (const id of plan.elementIds) {
    const el = draft.modelElements[id];
    if (el) for (const m of collectMemberIds(el)) removedMemberIds.add(m);
  }
  for (const id of plan.diagramIds) delete draft.diagrams[id];
  for (const [diagramId, viewIds] of plan.viewsByDiagram) {
    const diagram = draft.diagrams[diagramId];
    if (diagram) removeViewsFromDiagram(diagram, viewIds);
  }
  for (const id of plan.elementIds) delete draft.modelElements[id];
  for (const el of Object.values(draft.modelElements)) {
    clearReferencesTo(el, plan.elementIds);
    if (el.kind === 'instanceSpecification') {
      for (const slot of el.slots) {
        if (slot.definingFeatureId && removedMemberIds.has(slot.definingFeatureId))
          slot.definingFeatureId = null;
      }
    }
  }
}
