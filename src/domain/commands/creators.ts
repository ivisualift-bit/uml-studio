import type { IdGenerator } from '../ids';
import type { ID, Point } from '../schemas/common';
import {
  isRelationship,
  type ElementKind,
  type FragmentOperator,
  type ModelElement,
  type NodeElementKind,
  type RelationshipKind,
} from '../schemas/elements';
import type { MessageSort } from '../schemas/members';
import type { DiagramKind, ProjectDocument, UMLDiagram } from '../schemas/project';
import type { DiagramView, EdgeView, NodeView } from '../schemas/views';
import { makeDiagram, makeElement, makeOperand, makeView } from '../model/factory';
import {
  canOwn,
  checkRelationshipEndpoints,
  DIAGRAM_KIND_INFO,
  diagramAllowsElement,
  diagramAllowsRelationship,
  PACKAGE_LIKE,
  type EndpointProblem,
} from '../model/metadata';
import { visualDescendants } from '../services/containment';
import { cloneFragment, type ClipboardPayload } from '../services/cloneAndRemap';
import { endpointInfo, nearestPackageId, relationshipsOf, uniqueChildName, viewsOfElement } from '../services/queries';
import type { Command } from './types';

/**
 * Pure command creators: compute fresh IDs, owners and default geometry, returning commands that
 * the engine executes atomically. They never mutate the document.
 */

export type CreatorResult<T = Command[]> = { ok: true; commands: T; createdViewIds: ID[] } | { ok: false; reason: string };

// -------------------------------------------------------------------------------------------------
// Diagrams
// -------------------------------------------------------------------------------------------------

export function createDiagramCommands(
  doc: ProjectDocument,
  options: { kind: DiagramKind; name: string; ownerId: ID; behaviorName?: string; ids: IdGenerator },
): CreatorResult & { diagramId?: ID } {
  const info = DIAGRAM_KIND_INFO[options.kind];
  if (info.renderMode === 'none') return { ok: false, reason: 'planned' };
  const owner = doc.modelElements[options.ownerId];
  if (!owner) return { ok: false, reason: 'notFound' };
  const elements: ModelElement[] = [];
  let diagramOwner = owner.id;
  if (!info.ownerKinds.includes(owner.kind)) {
    if (info.behaviorKind) {
      const packageId = PACKAGE_LIKE.includes(owner.kind) ? owner.id : nearestPackageId(doc, owner.id);
      const behaviorId = options.ids.next();
      elements.push(
        makeElement(info.behaviorKind, {
          id: behaviorId,
          name: options.behaviorName ?? options.name,
          ownerId: packageId,
        }),
      );
      diagramOwner = behaviorId;
    } else {
      diagramOwner = nearestPackageId(doc, owner.id);
    }
  }
  const diagram = makeDiagram({ id: options.ids.next(), kind: options.kind, name: options.name, ownerId: diagramOwner });
  return { ok: true, commands: [{ type: 'diagram/add', diagram, elements }], createdViewIds: [], diagramId: diagram.id };
}

// -------------------------------------------------------------------------------------------------
// Nodes
// -------------------------------------------------------------------------------------------------

/** Default semantic owner for an element created on a diagram. */
export function defaultOwnerFor(doc: ProjectDocument, diagram: UMLDiagram, kind: ElementKind): ID | null {
  const owner = doc.modelElements[diagram.ownerId];
  if (owner && canOwn(owner.kind, kind)) return owner.id;
  const pkg = nearestPackageId(doc, diagram.ownerId);
  const pkgEl = doc.modelElements[pkg];
  return pkgEl && canOwn(pkgEl.kind, kind) ? pkg : null;
}

export interface NodeSpec {
  kind: NodeElementKind;
  /** pseudoKind / nodeKind / actionKind / headStyle / operator depending on kind. */
  subKind?: string;
  baseName: string;
  /** Override the unique generated name (e.g. pseudo-states have no name). */
  name?: string;
}

function initFor(spec: NodeSpec, id: ID, name: string, ownerId: ID, ids: IdGenerator): ModelElement {
  const base = { id, name, ownerId };
  switch (spec.kind) {
    case 'controlNode':
      return makeElement('controlNode', { ...base, nodeKind: (spec.subKind ?? 'initial') as never });
    case 'pseudostate':
      return makeElement('pseudostate', { ...base, pseudoKind: (spec.subKind ?? 'initial') as never });
    case 'node':
      return makeElement('node', { ...base, nodeKind: (spec.subKind ?? 'node') as never });
    case 'action':
      return makeElement('action', { ...base, actionKind: (spec.subKind ?? 'opaque') as never });
    case 'lifeline':
      return makeElement('lifeline', { ...base, headStyle: spec.subKind === 'actor' ? 'actor' : 'object' });
    case 'combinedFragment': {
      const operator = (spec.subKind ?? 'alt') as FragmentOperator;
      const operands = [makeOperand({ id: ids.next(), guard: '' })];
      if (operator === 'alt') operands.push(makeOperand({ id: ids.next(), guard: 'else' }));
      return makeElement('combinedFragment', { ...base, operator, operands });
    }
    case 'message':
    case 'activation':
      throw new Error('Use the sequence creators for messages and activations');
    default:
      return makeElement(spec.kind, base as never);
  }
}

const UNNAMED_BY_DEFAULT = new Set<string>(['pseudostate', 'controlNode', 'finalState']);

export function createNodeCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; spec: NodeSpec; position: Point; size: { width: number; height: number }; ids: IdGenerator },
): CreatorResult & { elementId?: ID; viewId?: ID } {
  const diagram = doc.diagrams[options.diagramId];
  if (!diagram) return { ok: false, reason: 'notFound' };
  const { spec } = options;
  if (!diagramAllowsElement(diagram.kind, spec.kind)) return { ok: false, reason: 'notAllowed' };
  const ownerId = defaultOwnerFor(doc, diagram, spec.kind);
  if (!ownerId) return { ok: false, reason: 'noOwner' };
  const elementId = options.ids.next();
  const name =
    spec.name ?? (UNNAMED_BY_DEFAULT.has(spec.kind) ? '' : uniqueChildName(doc, ownerId, spec.kind, spec.baseName));
  const element = initFor(spec, elementId, name, ownerId, options.ids);
  const view = makeView('node', {
    id: options.ids.next(),
    elementId,
    x: Math.round(options.position.x),
    y: Math.round(options.position.y),
    width: options.size.width,
    height: options.size.height,
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [element], diagramId: diagram.id, views: [view] }],
    createdViewIds: [view.id],
    elementId,
    viewId: view.id,
  };
}

export function createNoteCommands(
  diagramId: ID,
  position: Point,
  size: { width: number; height: number },
  text: string,
  ids: IdGenerator,
): CreatorResult {
  const view = makeView('note', { id: ids.next(), text, x: Math.round(position.x), y: Math.round(position.y), ...size });
  return { ok: true, commands: [{ type: 'view/add', diagramId, views: [view] }], createdViewIds: [view.id] };
}

export function createNoteLinkCommands(diagram: UMLDiagram, noteViewId: ID, targetViewId: ID, ids: IdGenerator): CreatorResult {
  const note = diagram.views[noteViewId];
  const target = diagram.views[targetViewId];
  if (note?.kind !== 'note' || !target || target.id === note.id) return { ok: false, reason: 'notAllowed' };
  const view = makeView('noteLink', { id: ids.next(), sourceViewId: note.id, targetViewId: target.id });
  return { ok: true, commands: [{ type: 'view/add', diagramId: diagram.id, views: [view] }], createdViewIds: [view.id] };
}

// -------------------------------------------------------------------------------------------------
// Relationships
// -------------------------------------------------------------------------------------------------

export type RelationshipPreset =
  | 'association'
  | 'directedAssociation'
  | 'aggregation'
  | 'composition'
  | 'generalization'
  | 'realization'
  | 'dependency'
  | 'usage'
  | 'include'
  | 'extend'
  | 'packageImport'
  | 'packageMerge'
  | 'controlFlow'
  | 'objectFlow'
  | 'transition'
  | 'link'
  | 'connector'
  | 'assembly'
  | 'deployment'
  | 'manifestation'
  | 'communicationPath'
  | 'extension'
  | 'informationFlow';

export function presetKind(preset: RelationshipPreset): RelationshipKind {
  switch (preset) {
    case 'directedAssociation':
    case 'aggregation':
    case 'composition':
      return 'association';
    case 'usage':
      return 'dependency';
    case 'assembly':
      return 'connector';
    default:
      return preset;
  }
}

function presetInit(preset: RelationshipPreset): Record<string, unknown> {
  switch (preset) {
    case 'directedAssociation':
      return { targetEnd: { navigability: 'navigable' } };
    case 'aggregation':
      return { sourceEnd: { aggregation: 'shared' } };
    case 'composition':
      return { sourceEnd: { aggregation: 'composite', multiplicity: '1' } };
    case 'usage':
      return { stereotype: 'use' };
    case 'assembly':
      return { connectorKind: 'assembly' };
    default:
      return {};
  }
}

export type RelationshipCreation =
  | { ok: true; commands: Command[]; createdViewIds: ID[]; relationshipId: ID; edgeViewId: ID }
  | { ok: false; reason: EndpointProblem | 'notFound' | 'notAllowed' };

/** Check whether `preset` may connect the two node views (used for live target highlighting). */
export function checkConnection(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  preset: RelationshipPreset,
  sourceViewId: ID,
  targetViewId: ID,
): EndpointProblem | 'notFound' | 'notAllowed' | null {
  const kind = presetKind(preset);
  if (!diagramAllowsRelationship(diagram.kind, kind)) return 'notAllowed';
  const sv = diagram.views[sourceViewId];
  const tv = diagram.views[targetViewId];
  if (sv?.kind !== 'node' || tv?.kind !== 'node') return 'notFound';
  const source = doc.modelElements[sv.elementId];
  const target = doc.modelElements[tv.elementId];
  if (!source || !target) return 'notFound';
  return checkRelationshipEndpoints(kind, endpointInfo(source), endpointInfo(target));
}

export function createRelationshipCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; preset: RelationshipPreset; sourceViewId: ID; targetViewId: ID; ids: IdGenerator },
): RelationshipCreation {
  const diagram = doc.diagrams[options.diagramId];
  if (!diagram) return { ok: false, reason: 'notFound' };
  const problem = checkConnection(doc, diagram, options.preset, options.sourceViewId, options.targetViewId);
  if (problem) return { ok: false, reason: problem };
  const sv = diagram.views[options.sourceViewId] as NodeView;
  const tv = diagram.views[options.targetViewId] as NodeView;
  const kind = presetKind(options.preset);
  const relationshipId = options.ids.next();
  const relationship = makeElement(kind, {
    id: relationshipId,
    name: '',
    ownerId: sv.elementId,
    sourceId: sv.elementId,
    targetId: tv.elementId,
    ...presetInit(options.preset),
  } as never);
  const edge = makeView('edge', {
    id: options.ids.next(),
    elementId: relationshipId,
    sourceViewId: sv.id,
    targetViewId: tv.id,
    routing: diagram.options.defaultRouting,
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [relationship], diagramId: diagram.id, views: [edge] }],
    createdViewIds: [edge.id],
    relationshipId,
    edgeViewId: edge.id,
  };
}

// -------------------------------------------------------------------------------------------------
// Existing elements on a diagram (explorer drag & drop)
// -------------------------------------------------------------------------------------------------

/**
 * Add a new view of an EXISTING element (never clones semantics) and re-display its relationships
 * to elements already visible in the diagram.
 */
export function showElementCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; elementId: ID; position: Point; size: { width: number; height: number }; ids: IdGenerator },
): CreatorResult {
  const diagram = doc.diagrams[options.diagramId];
  const element = doc.modelElements[options.elementId];
  if (!diagram || !element) return { ok: false, reason: 'notFound' };
  if (isRelationship(element) || !diagramAllowsElement(diagram.kind, element.kind)) return { ok: false, reason: 'notAllowed' };
  if (DIAGRAM_KIND_INFO[diagram.kind].renderMode !== 'graph') return { ok: false, reason: 'notAllowed' };
  const node = makeView('node', {
    id: options.ids.next(),
    elementId: element.id,
    x: Math.round(options.position.x),
    y: Math.round(options.position.y),
    ...options.size,
  });
  const views: DiagramView[] = [node];
  const nodeViewsByElement = new Map<ID, NodeView>();
  for (const v of Object.values(diagram.views)) if (v.kind === 'node' && !nodeViewsByElement.has(v.elementId)) nodeViewsByElement.set(v.elementId, v);
  nodeViewsByElement.set(element.id, nodeViewsByElement.get(element.id) ?? node);
  const shownRelationships = new Set(Object.values(diagram.views).filter((v): v is EdgeView => v.kind === 'edge').map((v) => v.elementId));
  for (const rel of relationshipsOf(doc, element.id)) {
    if (shownRelationships.has(rel.id) || !diagramAllowsRelationship(diagram.kind, rel.kind)) continue;
    const sourceView = rel.sourceId === element.id ? node : nodeViewsByElement.get(rel.sourceId);
    const targetView = rel.targetId === element.id ? node : nodeViewsByElement.get(rel.targetId);
    if (!sourceView || !targetView) continue;
    views.push(
      makeView('edge', {
        id: options.ids.next(),
        elementId: rel.id,
        sourceViewId: sourceView.id,
        targetViewId: targetView.id,
        routing: diagram.options.defaultRouting,
      }),
    );
  }
  return { ok: true, commands: [{ type: 'view/add', diagramId: diagram.id, views }], createdViewIds: [node.id] };
}

// -------------------------------------------------------------------------------------------------
// Sequence timeline
// -------------------------------------------------------------------------------------------------

export const LIFELINE_TOP = 40;

export function createLifelineCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; x: number; baseName: string; headStyle: 'object' | 'actor'; typeElementId?: ID | null; name?: string; ids: IdGenerator },
): CreatorResult & { elementId?: ID; viewId?: ID } {
  const diagram = doc.diagrams[options.diagramId];
  if (diagram?.kind !== 'sequence') return { ok: false, reason: 'notFound' };
  const typeEl = options.typeElementId ? doc.modelElements[options.typeElementId] : undefined;
  const elementId = options.ids.next();
  const element = makeElement('lifeline', {
    id: elementId,
    name: options.name ?? (typeEl ? '' : uniqueChildName(doc, diagram.ownerId, 'lifeline', options.baseName)),
    ownerId: diagram.ownerId,
    headStyle: options.headStyle,
    typeElementId: typeEl?.id ?? null,
    typeName: typeEl?.name ?? '',
  });
  const view = makeView('lifeline', {
    id: options.ids.next(),
    elementId,
    x: Math.round(options.x),
    y: LIFELINE_TOP,
    width: options.headStyle === 'actor' ? 90 : 120,
    headHeight: options.headStyle === 'actor' ? 70 : 40,
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [element], diagramId: diagram.id, views: [view] }],
    createdViewIds: [view.id],
    elementId,
    viewId: view.id,
  };
}

export const SELF_MESSAGE_DROP = 24;

export function createMessageCommands(
  doc: ProjectDocument,
  options: {
    diagramId: ID;
    sourceViewId: ID | null;
    targetViewId: ID | null;
    sort: MessageSort;
    y: number;
    name: string;
    ids: IdGenerator;
  },
): CreatorResult & { elementId?: ID; viewId?: ID } {
  const diagram = doc.diagrams[options.diagramId];
  if (diagram?.kind !== 'sequence') return { ok: false, reason: 'notFound' };
  const lifelineOf = (viewId: ID | null): ID | null | undefined => {
    if (viewId === null) return null;
    const v = diagram.views[viewId];
    return v?.kind === 'lifeline' ? v.elementId : undefined;
  };
  const source = lifelineOf(options.sourceViewId);
  const target = lifelineOf(options.targetViewId);
  if (source === undefined || target === undefined || (source === null && target === null)) return { ok: false, reason: 'notFound' };
  const isSelf = source !== null && source === target;
  if (isSelf && (options.sort === 'create' || options.sort === 'destroy')) return { ok: false, reason: 'selfNotAllowed' };
  const elementId = options.ids.next();
  const element = makeElement('message', {
    id: elementId,
    name: options.name,
    ownerId: diagram.ownerId,
    sourceLifelineId: source,
    targetLifelineId: target,
    sort: options.sort,
  });
  const y = Math.max(0, Math.round(options.y));
  const view = makeView('message', {
    id: options.ids.next(),
    elementId,
    sourceViewId: options.sourceViewId,
    targetViewId: options.targetViewId,
    sendY: y,
    receiveY: isSelf ? y + SELF_MESSAGE_DROP : y,
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [element], diagramId: diagram.id, views: [view] }],
    createdViewIds: [view.id],
    elementId,
    viewId: view.id,
  };
}

export function createActivationCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; lifelineViewId: ID; startY: number; endY: number; ids: IdGenerator },
): CreatorResult {
  const diagram = doc.diagrams[options.diagramId];
  const lifelineView = diagram?.views[options.lifelineViewId];
  if (!diagram || lifelineView?.kind !== 'lifeline') return { ok: false, reason: 'notFound' };
  const elementId = options.ids.next();
  const element = makeElement('activation', { id: elementId, name: '', ownerId: diagram.ownerId, lifelineId: lifelineView.elementId });
  const view = makeView('activation', {
    id: options.ids.next(),
    elementId,
    lifelineViewId: lifelineView.id,
    startY: Math.round(options.startY),
    endY: Math.round(Math.max(options.endY, options.startY + 10)),
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [element], diagramId: diagram.id, views: [view] }],
    createdViewIds: [view.id],
  };
}

export function createFragmentCommands(
  doc: ProjectDocument,
  options: {
    diagramId: ID;
    operator: FragmentOperator;
    bounds: { x: number; y: number; width: number; height: number };
    ids: IdGenerator;
  },
): CreatorResult {
  const diagram = doc.diagrams[options.diagramId];
  if (diagram?.kind !== 'sequence') return { ok: false, reason: 'notFound' };
  const elementId = options.ids.next();
  const element = initFor({ kind: 'combinedFragment', subKind: options.operator, baseName: '' }, elementId, '', diagram.ownerId, options.ids);
  if (element.kind !== 'combinedFragment') return { ok: false, reason: 'internal' };
  const { x, y, width, height } = options.bounds;
  const operandYs: Record<ID, number> = {};
  element.operands.slice(1).forEach((operand, i, rest) => {
    operandYs[operand.id] = Math.round(y + ((i + 1) * height) / (rest.length + 1));
  });
  const view = makeView('fragment', {
    id: options.ids.next(),
    elementId,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    operandYs,
  });
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: [element], diagramId: diagram.id, views: [view] }],
    createdViewIds: [view.id],
  };
}

// -------------------------------------------------------------------------------------------------
// Clipboard / duplicate
// -------------------------------------------------------------------------------------------------

/** Expand a selection into a self-contained copy set (children, internal edges, timeline parts). */
export function copySelection(doc: ProjectDocument, diagramId: ID, viewIds: readonly ID[]): ClipboardPayload | null {
  const diagram = doc.diagrams[diagramId];
  if (!diagram) return null;
  const included = new Set<ID>();
  for (const id of viewIds) {
    const view = diagram.views[id];
    if (!view) continue;
    if (view.kind === 'edge' || view.kind === 'noteLink' || view.kind === 'message') continue; // added below when ends are included
    included.add(id);
    if (view.kind === 'node' || view.kind === 'note') for (const d of visualDescendants(diagram, id)) included.add(d);
  }
  const explicit = new Set(viewIds);
  for (const view of Object.values(diagram.views)) {
    if (view.kind === 'edge' || view.kind === 'noteLink') {
      if (included.has(view.sourceViewId) && included.has(view.targetViewId)) included.add(view.id);
    } else if (view.kind === 'activation') {
      if (included.has(view.lifelineViewId)) included.add(view.id);
    }
  }
  for (const view of Object.values(diagram.views)) {
    if (view.kind !== 'message') continue;
    const endsOk =
      (view.sourceViewId === null || included.has(view.sourceViewId)) && (view.targetViewId === null || included.has(view.targetViewId));
    if (endsOk && (explicit.has(view.id) || (view.sourceViewId !== null && view.targetViewId !== null))) included.add(view.id);
  }
  const views = Object.values(diagram.views).filter((v) => included.has(v.id));
  if (views.length === 0) return null;
  const elementIds = new Set(views.flatMap((v) => ('elementId' in v ? [v.elementId] : [])));
  const elements = [...elementIds].map((id) => doc.modelElements[id]).filter((e): e is ModelElement => !!e);
  return {
    format: 'uml-studio-clipboard',
    version: 1,
    sourceProjectId: doc.id,
    sourceDiagramId: diagram.id,
    elements: structuredClone(elements),
    views: structuredClone(views),
  };
}

export function pasteCommands(
  doc: ProjectDocument,
  options: { diagramId: ID; payload: ClipboardPayload; offset: Point; ids: IdGenerator },
): CreatorResult & { skipped?: number } {
  const diagram = doc.diagrams[options.diagramId];
  if (!diagram) return { ok: false, reason: 'notFound' };
  const info = DIAGRAM_KIND_INFO[diagram.kind];
  const allowedViewKinds = info.renderMode === 'sequence' ? ['lifeline', 'message', 'activation', 'fragment', 'note'] : ['node', 'edge', 'note', 'noteLink'];
  // Keep only what this diagram kind can show.
  const elements = options.payload.elements.filter((el) =>
    isRelationship(el) ? diagramAllowsRelationship(diagram.kind, el.kind) : diagramAllowsElement(diagram.kind, el.kind),
  );
  const elementIds = new Set(elements.map((e) => e.id));
  const views = options.payload.views.filter((v) => allowedViewKinds.includes(v.kind) && (!('elementId' in v) || elementIds.has(v.elementId)));
  const filteredOut = options.payload.elements.length - elements.length;
  const owners = new Map<ElementKind, ID | null>();
  const ownerFor = (kind: ElementKind) => {
    if (!owners.has(kind)) owners.set(kind, defaultOwnerFor(doc, diagram, kind));
    return owners.get(kind) ?? null;
  };
  const fallbackOwner = ownerFor(elements.find((e) => !isRelationship(e))?.kind ?? 'class') ?? diagram.ownerId;
  const cloned = cloneFragment({ ...options.payload, elements, views }, doc, options.ids, { ownerId: fallbackOwner, offset: options.offset });
  // Re-own non-relationship clones whose owner was not copied using the per-kind default owner.
  const clonedIds = new Set(cloned.elements.map((e) => e.id));
  const finalElements = cloned.elements.map((el) => {
    if (isRelationship(el) || clonedIds.has(el.ownerId ?? '')) return el;
    const owner = ownerFor(el.kind);
    return owner ? { ...el, ownerId: owner } : el;
  });
  if (finalElements.length === 0 && cloned.views.length === 0) return { ok: false, reason: 'empty' };
  return {
    ok: true,
    commands: [{ type: 'element/add', elements: finalElements, diagramId: diagram.id, views: cloned.views }],
    createdViewIds: cloned.views.map((v) => v.id),
    skipped: cloned.skipped + filteredOut,
  };
}

/**
 * Rename an element and keep the displayed type text of features that reference it semantically
 * (`typeElementId`) in sync — one transaction, one undo step.
 */
export function renameElementCommands(doc: ProjectDocument, elementId: ID, name: string): Command[] {
  const commands: Command[] = [{ type: 'element/update', elementId, patch: { name } }];
  const old = doc.modelElements[elementId]?.name;
  if (old === undefined || old === name) return commands;
  for (const el of Object.values(doc.modelElements)) {
    if ('attributes' in el) {
      for (const a of el.attributes) {
        if (a.typeElementId === elementId) commands.push({ type: 'member/update', elementId: el.id, collection: 'attributes', memberId: a.id, patch: { type: name } });
      }
      for (const o of el.operations) {
        if (o.returnTypeElementId === elementId) commands.push({ type: 'member/update', elementId: el.id, collection: 'operations', memberId: o.id, patch: { returnType: name } });
        for (const p of o.parameters) {
          if (p.typeElementId === elementId) {
            commands.push({ type: 'member/update', elementId: el.id, collection: 'parameters', operationId: o.id, memberId: p.id, patch: { type: name } });
          }
        }
      }
    }
    if ((el.kind === 'lifeline' || el.kind === 'part' || el.kind === 'port' || el.kind === 'objectNode') && el.typeElementId === elementId) {
      commands.push({ type: 'element/update', elementId: el.id, patch: { typeName: name } });
    }
  }
  return commands;
}

/** Resolve a typed type name to a unique classifier of the project (semantic type link). */
export function resolveTypeElement(doc: ProjectDocument, typeText: string): ID | null {
  const name = typeText.trim().replace(/\[\]$/, '');
  if (!name) return null;
  const matches = Object.values(doc.modelElements).filter(
    (e) => e.name === name && (e.kind === 'class' || e.kind === 'interface' || e.kind === 'enumeration' || e.kind === 'dataType' || e.kind === 'primitiveType' || e.kind === 'signal' || e.kind === 'component'),
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

/** All views (in all diagrams) of the given elements — used by the delete-from-model dialog. */
export function viewCountOf(doc: ProjectDocument, elementIds: Iterable<ID>): number {
  let count = 0;
  for (const id of elementIds) count += viewsOfElement(doc, id).length;
  return count;
}
