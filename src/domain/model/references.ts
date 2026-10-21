import type { ID } from '../schemas/common';
import {
  hasFeatures,
  hasPartition,
  isRelationship,
  type ElementKind,
  type ModelElement,
} from '../schemas/elements';

/**
 * Element → element references (besides ownership).
 * - `cascade`: the referencing element cannot exist without the target (relationship ends, messages).
 * - `clear`: the reference is optional and is reset when the target disappears.
 */
export type ReferencePolicy = 'cascade' | 'clear';

export interface ElementReference {
  field: string;
  targetId: ID;
  policy: ReferencePolicy;
  /** Kinds the target must have (integrity). Omitted = any element. */
  targetKinds?: readonly ElementKind[];
}

const TYPE_KINDS: readonly ElementKind[] = [
  'class',
  'interface',
  'enumeration',
  'dataType',
  'primitiveType',
  'signal',
  'component',
  'actor',
  'artifact',
  'node',
  'collaboration',
  'informationItem',
  'useCase',
];

export function collectReferences(el: ModelElement): ElementReference[] {
  const refs: ElementReference[] = [];
  if (isRelationship(el)) {
    refs.push({ field: 'sourceId', targetId: el.sourceId, policy: 'cascade' });
    refs.push({ field: 'targetId', targetId: el.targetId, policy: 'cascade' });
  }
  if (hasFeatures(el)) {
    for (const a of el.attributes) {
      if (a.typeElementId)
        refs.push({
          field: `attributes.${a.id}.typeElementId`,
          targetId: a.typeElementId,
          policy: 'clear',
          targetKinds: TYPE_KINDS,
        });
    }
    for (const o of el.operations) {
      if (o.returnTypeElementId) {
        refs.push({
          field: `operations.${o.id}.returnTypeElementId`,
          targetId: o.returnTypeElementId,
          policy: 'clear',
          targetKinds: TYPE_KINDS,
        });
      }
      for (const p of o.parameters) {
        if (p.typeElementId) {
          refs.push({
            field: `operations.${o.id}.parameters.${p.id}.typeElementId`,
            targetId: p.typeElementId,
            policy: 'clear',
            targetKinds: TYPE_KINDS,
          });
        }
      }
    }
  }
  if (hasPartition(el) && el.partitionId) {
    refs.push({
      field: 'partitionId',
      targetId: el.partitionId,
      policy: 'clear',
      targetKinds: ['activityPartition'],
    });
  }
  for (const applied of el.appliedStereotypes) {
    refs.push({
      field: `appliedStereotypes.${applied.id}`,
      targetId: applied.stereotypeId,
      policy: 'clear',
      targetKinds: ['stereotype'],
    });
  }
  switch (el.kind) {
    case 'instanceSpecification':
      if (el.classifierId)
        refs.push({
          field: 'classifierId',
          targetId: el.classifierId,
          policy: 'clear',
          targetKinds: TYPE_KINDS,
        });
      break;
    case 'port':
    case 'part':
    case 'objectNode':
    case 'lifeline':
      if (el.typeElementId)
        refs.push({
          field: 'typeElementId',
          targetId: el.typeElementId,
          policy: 'clear',
          targetKinds: TYPE_KINDS,
        });
      break;
    case 'message':
      if (el.sourceLifelineId)
        refs.push({
          field: 'sourceLifelineId',
          targetId: el.sourceLifelineId,
          policy: 'cascade',
          targetKinds: ['lifeline'],
        });
      if (el.targetLifelineId)
        refs.push({
          field: 'targetLifelineId',
          targetId: el.targetLifelineId,
          policy: 'cascade',
          targetKinds: ['lifeline'],
        });
      break;
    case 'activation':
      refs.push({
        field: 'lifelineId',
        targetId: el.lifelineId,
        policy: 'cascade',
        targetKinds: ['lifeline'],
      });
      break;
    case 'link':
      if (el.associationId)
        refs.push({
          field: 'associationId',
          targetId: el.associationId,
          policy: 'clear',
          targetKinds: ['association'],
        });
      break;
    case 'informationFlow':
      for (const id of el.conveyedIds) refs.push({ field: 'conveyedIds', targetId: id, policy: 'clear' });
      break;
    default:
      break;
  }
  return refs;
}

/**
 * Reset every `clear`-policy reference of a (draft) element that points into `removed`.
 * Mutates the element in place; intended to be called on Immer drafts.
 */
export function clearReferencesTo(el: ModelElement, removed: ReadonlySet<ID>): void {
  if (hasFeatures(el)) {
    for (const a of el.attributes)
      if (a.typeElementId && removed.has(a.typeElementId)) a.typeElementId = null;
    for (const o of el.operations) {
      if (o.returnTypeElementId && removed.has(o.returnTypeElementId)) o.returnTypeElementId = null;
      for (const p of o.parameters)
        if (p.typeElementId && removed.has(p.typeElementId)) p.typeElementId = null;
    }
  }
  if (hasPartition(el) && el.partitionId && removed.has(el.partitionId)) el.partitionId = null;
  if (el.appliedStereotypes.some((s) => removed.has(s.stereotypeId))) {
    el.appliedStereotypes = el.appliedStereotypes.filter((s) => !removed.has(s.stereotypeId));
  }
  switch (el.kind) {
    case 'instanceSpecification':
      if (el.classifierId && removed.has(el.classifierId)) el.classifierId = null;
      break;
    case 'port':
    case 'part':
    case 'objectNode':
    case 'lifeline':
      if (el.typeElementId && removed.has(el.typeElementId)) el.typeElementId = null;
      break;
    case 'link':
      if (el.associationId && removed.has(el.associationId)) el.associationId = null;
      break;
    case 'informationFlow':
      if (el.conveyedIds.some((id) => removed.has(id)))
        el.conveyedIds = el.conveyedIds.filter((id) => !removed.has(id));
      break;
    default:
      break;
  }
}

/** All member (owned value object) IDs of an element, for global uniqueness checks. */
export function collectMemberIds(el: ModelElement): ID[] {
  const ids: ID[] = el.appliedStereotypes.map((s) => s.id);
  if (hasFeatures(el)) {
    for (const a of el.attributes) ids.push(a.id);
    for (const o of el.operations) {
      ids.push(o.id);
      for (const p of o.parameters) ids.push(p.id);
    }
  }
  switch (el.kind) {
    case 'enumeration':
      for (const l of el.literals) ids.push(l.id);
      break;
    case 'useCase':
      for (const e of el.extensionPoints) ids.push(e.id);
      break;
    case 'combinedFragment':
      for (const o of el.operands) ids.push(o.id);
      break;
    case 'instanceSpecification':
      for (const s of el.slots) ids.push(s.id);
      break;
    case 'stereotype':
      for (const t of el.tagDefinitions) ids.push(t.id);
      break;
    case 'connector':
      for (const m of el.messages) ids.push(m.id);
      break;
    default:
      break;
  }
  return ids;
}
