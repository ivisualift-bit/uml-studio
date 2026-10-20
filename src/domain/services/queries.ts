import type { ID } from '../schemas/common';
import { isRelationship, type ElementKind, type ElementOf, type ModelElement, type Relationship } from '../schemas/elements';
import type { ProjectDocument, UMLDiagram } from '../schemas/project';
import type { DiagramView } from '../schemas/views';
import type { EndpointInfo } from '../model/metadata';

/**
 * Read-only queries over an immutable project document. Indexes are memoised per record object
 * identity: Immer produces new records only when something inside changed.
 */

type ElementRecord = ProjectDocument['modelElements'];
type DiagramRecord = ProjectDocument['diagrams'];

interface ElementIndex {
  children: Map<ID, ID[]>;
  relationshipsByEnd: Map<ID, ID[]>;
}
const elementIndexCache = new WeakMap<ElementRecord, ElementIndex>();

function elementIndex(elements: ElementRecord): ElementIndex {
  let index = elementIndexCache.get(elements);
  if (index) return index;
  const children = new Map<ID, ID[]>();
  const relationshipsByEnd = new Map<ID, ID[]>();
  const push = (map: Map<ID, ID[]>, key: ID, value: ID) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const el of Object.values(elements)) {
    if (el.ownerId) push(children, el.ownerId, el.id);
    if (isRelationship(el)) {
      push(relationshipsByEnd, el.sourceId, el.id);
      if (el.targetId !== el.sourceId) push(relationshipsByEnd, el.targetId, el.id);
    }
  }
  index = { children, relationshipsByEnd };
  elementIndexCache.set(elements, index);
  return index;
}

export interface ViewLocation {
  diagramId: ID;
  view: DiagramView;
}
const viewIndexCache = new WeakMap<DiagramRecord, Map<ID, ViewLocation[]>>();

function viewIndex(diagrams: DiagramRecord): Map<ID, ViewLocation[]> {
  let index = viewIndexCache.get(diagrams);
  if (index) return index;
  index = new Map();
  for (const diagram of Object.values(diagrams)) {
    for (const view of Object.values(diagram.views)) {
      if (!('elementId' in view)) continue;
      const list = index.get(view.elementId);
      const loc = { diagramId: diagram.id, view };
      if (list) list.push(loc);
      else index.set(view.elementId, [loc]);
    }
  }
  viewIndexCache.set(diagrams, index);
  return index;
}

export function getElement(doc: ProjectDocument, id: ID | null | undefined): ModelElement | undefined {
  return id ? doc.modelElements[id] : undefined;
}

export function getElementOfKind<K extends ElementKind>(
  doc: ProjectDocument,
  id: ID | null | undefined,
  kind: K,
): ElementOf<K> | undefined {
  const el = getElement(doc, id);
  return el && el.kind === kind ? (el as ElementOf<K>) : undefined;
}

export function childrenOf(doc: ProjectDocument, ownerId: ID): ModelElement[] {
  const ids = elementIndex(doc.modelElements).children.get(ownerId) ?? [];
  return ids.map((id) => doc.modelElements[id]).filter((e): e is ModelElement => !!e);
}

/** Owned descendants (depth-first), not including the element itself. Cycle-safe. */
export function descendantIds(doc: ProjectDocument, id: ID): ID[] {
  const result: ID[] = [];
  const seen = new Set<ID>([id]);
  const stack = [...(elementIndex(doc.modelElements).children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    stack.push(...(elementIndex(doc.modelElements).children.get(next) ?? []));
  }
  return result;
}

/** Owner chain from the direct owner up to the root (cycle-safe). */
export function ancestorIds(doc: ProjectDocument, id: ID): ID[] {
  const result: ID[] = [];
  const seen = new Set<ID>([id]);
  let current = doc.modelElements[id]?.ownerId ?? null;
  while (current && !seen.has(current)) {
    result.push(current);
    seen.add(current);
    current = doc.modelElements[current]?.ownerId ?? null;
  }
  return result;
}

export function relationshipsOf(doc: ProjectDocument, elementId: ID): Relationship[] {
  const ids = elementIndex(doc.modelElements).relationshipsByEnd.get(elementId) ?? [];
  return ids.map((id) => doc.modelElements[id]).filter((e): e is Relationship => !!e && isRelationship(e));
}

export function viewsOfElement(doc: ProjectDocument, elementId: ID): ViewLocation[] {
  return viewIndex(doc.diagrams).get(elementId) ?? [];
}

export function diagramsOwnedBy(doc: ProjectDocument, ownerId: ID): UMLDiagram[] {
  return Object.values(doc.diagrams).filter((d) => d.ownerId === ownerId);
}

export function subKindOf(el: ModelElement): string | undefined {
  if (el.kind === 'pseudostate') return el.pseudoKind;
  if (el.kind === 'controlNode') return el.nodeKind;
  if (el.kind === 'node') return el.nodeKind;
  if (el.kind === 'combinedFragment') return el.operator;
  if (el.kind === 'message') return el.sort;
  return undefined;
}

export function endpointInfo(el: ModelElement): EndpointInfo {
  return { id: el.id, kind: el.kind, subKind: subKindOf(el) };
}

/** Nearest package-like owner (model/package/profile) of an element, or the root. */
export function nearestPackageId(doc: ProjectDocument, id: ID): ID {
  let current: ModelElement | undefined = doc.modelElements[id];
  const seen = new Set<ID>();
  while (current && !seen.has(current.id)) {
    if (current.kind === 'model' || current.kind === 'package' || current.kind === 'profile') return current.id;
    seen.add(current.id);
    current = current.ownerId ? doc.modelElements[current.ownerId] : undefined;
  }
  return doc.rootModelId;
}

/** Qualified name `Root::pkg::Class` (used by search and code generation). */
export function qualifiedName(doc: ProjectDocument, id: ID, separator = '::'): string {
  const el = doc.modelElements[id];
  if (!el) return '';
  const names = ancestorIds(doc, id)
    .reverse()
    .map((a) => doc.modelElements[a]?.name ?? '');
  return [...names, el.name].join(separator);
}

/** Generates `${base}${n}` unique among the owner's children of the same kind. */
export function uniqueChildName(doc: ProjectDocument, ownerId: ID, kind: ElementKind, base: string): string {
  const used = new Set(
    childrenOf(doc, ownerId)
      .filter((c) => c.kind === kind)
      .map((c) => c.name),
  );
  for (let n = 1; n < 100_000; n += 1) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

export function findViewById(doc: ProjectDocument, viewId: ID): ViewLocation | undefined {
  for (const diagram of Object.values(doc.diagrams)) {
    const view = diagram.views[viewId];
    if (view) return { diagramId: diagram.id, view };
  }
  return undefined;
}
