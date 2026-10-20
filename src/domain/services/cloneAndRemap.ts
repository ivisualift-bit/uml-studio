import type { IdGenerator } from '../ids';
import type { ID } from '../schemas/common';
import type { ModelElement } from '../schemas/elements';
import type { ProjectDocument } from '../schemas/project';
import type { DiagramView } from '../schemas/views';
import { collectMemberIds } from '../model/references';
import { isPlainObject } from '../util';

/**
 * Schema invariant relied upon here (and tested): every identifier-valued field is named `id`,
 * `…Id` or `…Ids`, and the only ID-keyed records are `modelElements`, `diagrams`, `views`
 * and `operandYs`. Free-text fields (names, types, documentation) are never touched.
 */
const ID_KEYED_RECORDS = new Set(['modelElements', 'diagrams', 'views', 'operandYs']);

function isIdField(key: string): boolean {
  return key === 'id' || key.endsWith('Id');
}

export function remapIds<T>(value: T, map: ReadonlyMap<ID, ID>): T {
  const visit = (node: unknown, key: string | null): unknown => {
    if (typeof node === 'string') return key !== null && isIdField(key) ? (map.get(node) ?? node) : node;
    if (Array.isArray(node)) {
      if (key !== null && key.endsWith('Ids')) return node.map((v) => (typeof v === 'string' ? (map.get(v) ?? v) : v));
      return node.map((v) => visit(v, null));
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      const remapKeys = key !== null && ID_KEYED_RECORDS.has(key);
      for (const [k, v] of Object.entries(node)) out[remapKeys ? (map.get(k) ?? k) : k] = visit(v, k);
      return out;
    }
    return node;
  };
  return visit(value, null) as T;
}

/** All identifiers declared in a project (project, elements, members, diagrams, views). */
export function collectDeclaredIds(doc: ProjectDocument): ID[] {
  const ids: ID[] = [doc.id];
  for (const el of Object.values(doc.modelElements)) ids.push(el.id, ...collectMemberIds(el));
  for (const diagram of Object.values(doc.diagrams)) {
    ids.push(diagram.id);
    for (const view of Object.values(diagram.views)) ids.push(view.id);
  }
  return ids;
}

/** Deep copy with every identifier replaced (template instantiation, "duplicate project"). */
export function cloneProjectWithFreshIds(doc: ProjectDocument, ids: IdGenerator): ProjectDocument {
  const map = new Map<ID, ID>();
  for (const id of collectDeclaredIds(doc)) map.set(id, ids.next());
  return remapIds(doc, map);
}

// -------------------------------------------------------------------------------------------------
// Clipboard fragments
// -------------------------------------------------------------------------------------------------

export interface ClipboardPayload {
  format: 'uml-studio-clipboard';
  version: 1;
  sourceProjectId: ID;
  sourceDiagramId: ID;
  /** Semantic elements whose views are copied (plus relationships between them). */
  elements: ModelElement[];
  views: DiagramView[];
}

export interface CloneFragmentResult {
  elements: ModelElement[];
  views: DiagramView[];
  /** Elements dropped because they depend on something unavailable in the destination. */
  skipped: number;
}

/**
 * Clone a clipboard fragment for pasting: fresh IDs for elements, members and views; internal
 * references remapped; external references kept when the target exists in `dest`, cleared
 * otherwise. Elements whose required references cannot be satisfied are skipped with their views.
 */
export function cloneFragment(
  payload: ClipboardPayload,
  dest: ProjectDocument,
  ids: IdGenerator,
  options: { ownerId: ID; offset: { x: number; y: number } },
): CloneFragmentResult {
  const map = new Map<ID, ID>();
  for (const el of payload.elements) {
    map.set(el.id, ids.next());
    for (const memberId of collectMemberIds(el)) map.set(memberId, ids.next());
  }
  for (const view of payload.views) map.set(view.id, ids.next());

  const resolvable = (id: ID | null): boolean => id === null || map.has(id) || !!dest.modelElements[id];
  const kept: ModelElement[] = [];
  let skipped = 0;
  for (const el of payload.elements) {
    const required: Array<ID | null> = [];
    if ('sourceId' in el) required.push(el.sourceId, el.targetId);
    if (el.kind === 'message') required.push(el.sourceLifelineId, el.targetLifelineId);
    if (el.kind === 'activation') required.push(el.lifelineId);
    if (!required.every(resolvable)) {
      skipped += 1;
      map.delete(el.id);
      continue;
    }
    kept.push(el);
  }
  const keptIds = new Set(kept.map((e) => e.id));

  const elements = kept.map((el) => {
    const clone = remapIds(el, map);
    // Owner: cloned owner if it was copied too, else the paste target owner.
    const ownerCopied = el.ownerId !== null && keptIds.has(el.ownerId);
    const relationshipOwner = 'sourceId' in clone ? clone.sourceId : null;
    clone.ownerId = ownerCopied ? map.get(el.ownerId!)! : (relationshipOwner ?? options.ownerId);
    return clearUnresolvable(clone, dest, new Set(map.values()));
  });

  const viewIdsKept = new Set<ID>();
  const views: DiagramView[] = [];
  for (const view of payload.views) {
    if ('elementId' in view && !keptIds.has(view.elementId)) continue;
    viewIdsKept.add(view.id);
  }
  for (const view of payload.views) {
    if (!viewIdsKept.has(view.id)) continue;
    const refsOk = (() => {
      switch (view.kind) {
        case 'edge':
        case 'noteLink':
          return viewIdsKept.has(view.sourceViewId) && viewIdsKept.has(view.targetViewId);
        case 'message':
          return (
            (view.sourceViewId === null || viewIdsKept.has(view.sourceViewId)) &&
            (view.targetViewId === null || viewIdsKept.has(view.targetViewId))
          );
        case 'activation':
          return viewIdsKept.has(view.lifelineViewId);
        default:
          return true;
      }
    })();
    if (!refsOk) continue;
    const clone = remapIds(view, map);
    views.push(offsetView(clone, options.offset, viewIdsKept, map));
  }
  // Drop elements that lost every view (e.g. a message whose lifeline view was not copied).
  const shown = new Set(views.flatMap((v) => ('elementId' in v ? [v.elementId] : [])));
  const finalElements = elements.filter((e) => shown.has(e.id) || !payload.views.some((v) => 'elementId' in v && map.get(v.elementId) === e.id));
  return { elements: finalElements, views, skipped: skipped + (elements.length - finalElements.length) };
}

function clearUnresolvable(el: ModelElement, dest: ProjectDocument, newIds: ReadonlySet<ID>): ModelElement {
  const exists = (id: ID | null) => id === null || newIds.has(id) || !!dest.modelElements[id];
  const copy = structuredClone(el);
  if ('attributes' in copy) {
    for (const a of copy.attributes) if (!exists(a.typeElementId)) a.typeElementId = null;
    for (const o of copy.operations) {
      if (!exists(o.returnTypeElementId)) o.returnTypeElementId = null;
      for (const p of o.parameters) if (!exists(p.typeElementId)) p.typeElementId = null;
    }
  }
  if ('partitionId' in copy && !exists(copy.partitionId)) copy.partitionId = null;
  if ('typeElementId' in copy && !exists(copy.typeElementId)) copy.typeElementId = null;
  if (copy.kind === 'instanceSpecification') {
    if (!exists(copy.classifierId)) copy.classifierId = null;
    for (const s of copy.slots) s.definingFeatureId = null;
  }
  if (copy.kind === 'link' && !exists(copy.associationId)) copy.associationId = null;
  if (copy.kind === 'informationFlow') copy.conveyedIds = copy.conveyedIds.filter(exists);
  if (copy.kind === 'extend') copy.extensionPointIds = copy.extensionPointIds.filter((id) => newIds.has(id));
  copy.appliedStereotypes = copy.appliedStereotypes.filter((s) => exists(s.stereotypeId));
  return copy;
}

function offsetView(
  view: DiagramView,
  offset: { x: number; y: number },
  keptOriginalIds: ReadonlySet<ID>,
  map: ReadonlyMap<ID, ID>,
): DiagramView {
  const keptNew = new Set([...keptOriginalIds].map((id) => map.get(id)));
  switch (view.kind) {
    case 'node':
    case 'note':
      return {
        ...view,
        x: view.x + offset.x,
        y: view.y + offset.y,
        containerViewId: view.containerViewId && keptNew.has(view.containerViewId) ? view.containerViewId : null,
      };
    case 'edge':
    case 'noteLink':
      return { ...view, waypoints: view.waypoints.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) };
    case 'lifeline':
      return { ...view, x: view.x + offset.x };
    case 'message':
      return { ...view, sendY: view.sendY + offset.y, receiveY: view.receiveY + offset.y };
    case 'activation':
      return { ...view, startY: view.startY + offset.y, endY: view.endY + offset.y };
    case 'fragment':
      return {
        ...view,
        x: view.x + offset.x,
        y: view.y + offset.y,
        operandYs: Object.fromEntries(Object.entries(view.operandYs).map(([k, y]) => [k, y + offset.y])),
      };
    default:
      return view;
  }
}
