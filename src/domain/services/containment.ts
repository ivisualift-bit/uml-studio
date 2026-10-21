import type { ID } from '../schemas/common';
import { hasPartition } from '../schemas/elements';
import type { ProjectDocument, UMLDiagram } from '../schemas/project';
import type { BoxView, DiagramView } from '../schemas/views';
import { canOwn, containmentEffect, CONTAINER_KINDS, DIAGRAM_KIND_INFO } from '../model/metadata';
import type { Bounds, ViewMeasurer } from '../commands/types';
import type { Transaction } from '../commands/transaction';
import { ancestorIds } from './queries';

export function storedBounds(view: BoxView): Bounds {
  return { x: view.x, y: view.y, width: view.width, height: view.height };
}

export function boundsOf(doc: ProjectDocument, diagram: UMLDiagram, view: BoxView, measure?: ViewMeasurer): Bounds {
  return (measure ? measure(doc, diagram, view) : null) ?? storedBounds(view);
}

function contains(outer: Bounds, x: number, y: number, slack = 0): boolean {
  return (
    x >= outer.x - slack && x <= outer.x + outer.width + slack && y >= outer.y - slack && y <= outer.y + outer.height + slack
  );
}

/** Views visually inside `viewId` (transitively). */
export function visualDescendants(diagram: UMLDiagram, viewId: ID): ID[] {
  const result: ID[] = [];
  const frontier = [viewId];
  const seen = new Set<ID>([viewId]);
  while (frontier.length) {
    const current = frontier.pop()!;
    for (const v of Object.values(diagram.views)) {
      if ((v.kind === 'node' || v.kind === 'note') && v.containerViewId === current && !seen.has(v.id)) {
        seen.add(v.id);
        result.push(v.id);
        frontier.push(v.id);
      }
    }
  }
  return result;
}

/** Best (smallest) compatible container whose bounds contain the centre of `view`. */
export function findContainerFor(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  view: BoxView,
  measure?: ViewMeasurer,
): BoxView | null {
  const childKind = view.kind === 'note' ? 'note' : doc.modelElements[view.elementId]?.kind;
  if (!childKind) return null;
  const b = boundsOf(doc, diagram, view, measure);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const excluded = new Set([view.id, ...visualDescendants(diagram, view.id)]);
  let best: { view: BoxView; area: number } | null = null;
  for (const candidate of Object.values(diagram.views)) {
    if (candidate.kind !== 'node' || excluded.has(candidate.id)) continue;
    const containerEl = doc.modelElements[candidate.elementId];
    if (!containerEl || !CONTAINER_KINDS.has(containerEl.kind)) continue;
    if (!containmentEffect(containerEl.kind, childKind)) continue;
    const cb = boundsOf(doc, diagram, candidate, measure);
    const slack = childKind === 'port' ? Math.max(b.width, b.height) : 0;
    if (!contains(cb, cx, cy, slack)) continue;
    const area = cb.width * cb.height;
    if (!best || area < best.area) best = { view: candidate, area };
  }
  return best?.view ?? null;
}

/** Owner used when an element leaves a semantic container: the diagram's owner when legal. */
function fallbackOwner(doc: ProjectDocument, diagram: UMLDiagram, elementKind: Parameters<typeof canOwn>[1]): ID | null {
  const diagramOwner = doc.modelElements[diagram.ownerId];
  if (diagramOwner && canOwn(diagramOwner.kind, elementKind)) return diagramOwner.id;
  return null;
}

/**
 * Recompute visual containers of the given views and apply the explicit semantic effect of each
 * change (ownership move, partition membership). Operates on an Immer draft.
 */
export function applyContainment(
  draft: ProjectDocument,
  diagramId: ID,
  viewIds: Iterable<ID>,
  tx: Transaction,
): void {
  const diagram = draft.diagrams[diagramId];
  if (!diagram || DIAGRAM_KIND_INFO[diagram.kind].renderMode !== 'graph') return;
  for (const viewId of viewIds) {
    const view: DiagramView | undefined = diagram.views[viewId];
    if (!view || (view.kind !== 'node' && view.kind !== 'note')) continue;
    const previousContainer = view.containerViewId ? diagram.views[view.containerViewId] : undefined;
    const container = findContainerFor(draft, diagram, view, tx.measure);
    const newContainerId = container?.id ?? null;
    if (newContainerId !== view.containerViewId) {
      view.containerViewId = newContainerId;
      tx.touchView(diagramId, view.id);
    }
    if (view.kind !== 'node') continue;
    const element = draft.modelElements[view.elementId];
    if (!element) continue;
    const containerEl = container?.kind === 'node' ? draft.modelElements[container.elementId] : undefined;
    const effect = containerEl ? containmentEffect(containerEl.kind, element.kind) : null;
    const previousEl =
      previousContainer?.kind === 'node' ? draft.modelElements[previousContainer.elementId] : undefined;

    // Ownership effect.
    if (effect === 'owner' && containerEl && element.ownerId !== containerEl.id) {
      const wouldCycle = containerEl.id === element.id || ancestorIds(draft, containerEl.id).includes(element.id);
      if (!wouldCycle && canOwn(containerEl.kind, element.kind)) {
        element.ownerId = containerEl.id;
        tx.touchElement(element.id);
      }
    } else if (effect !== 'owner' && previousEl && element.ownerId === previousEl.id) {
      const owner = fallbackOwner(draft, diagram, element.kind);
      if (owner && owner !== element.id) {
        element.ownerId = owner;
        tx.touchElement(element.id);
      }
    }

    // Partition effect (only lanes of this diagram change membership).
    if (hasPartition(element)) {
      if (effect === 'partition' && containerEl && element.partitionId !== containerEl.id) {
        element.partitionId = containerEl.id;
        tx.touchElement(element.id);
      } else if (
        effect !== 'partition' &&
        previousEl?.kind === 'activityPartition' &&
        element.partitionId === previousEl.id
      ) {
        element.partitionId = null;
        tx.touchElement(element.id);
      }
    }
  }
}
