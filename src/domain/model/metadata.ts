import type { DiagramKind } from '../schemas/project';
import type { ElementKind, NodeElementKind, RelationshipKind } from '../schemas/elements';

/**
 * Static UML rules shared by commands, integrity checks, validation and the UI registry.
 * Keeping them here (pure data) guarantees the canvas and the model engine agree.
 */

export const PACKAGE_LIKE: readonly ElementKind[] = ['model', 'package', 'profile'];

export const CLASSIFIER_KINDS: readonly ElementKind[] = [
  'class',
  'interface',
  'enumeration',
  'dataType',
  'primitiveType',
  'signal',
  'component',
];

/** Elements that may live directly inside a package-like container. */
const PACKAGEABLE: readonly ElementKind[] = [
  'package',
  'profile',
  ...CLASSIFIER_KINDS,
  'instanceSpecification',
  'artifact',
  'node',
  'collaboration',
  'stereotype',
  'metaclass',
  'informationItem',
  'actor',
  'useCase',
  'subject',
  'interaction',
  'activity',
  'stateMachine',
];

const OWNERSHIP: Partial<Record<ElementKind, readonly ElementKind[]>> = {
  model: PACKAGEABLE,
  package: PACKAGEABLE,
  profile: PACKAGEABLE,
  class: ['port', 'part'],
  component: ['port', 'part', 'component', 'class', 'interface', 'artifact'],
  collaboration: ['part'],
  node: ['node', 'artifact'],
  interaction: ['lifeline', 'message', 'combinedFragment', 'activation'],
  activity: ['action', 'controlNode', 'objectNode', 'activityPartition'],
  stateMachine: ['state', 'pseudostate', 'finalState'],
  state: ['state', 'pseudostate', 'finalState'],
};

const RELATIONSHIP_SET = new Set<string>([
  'association',
  'generalization',
  'realization',
  'dependency',
  'include',
  'extend',
  'packageImport',
  'packageMerge',
  'controlFlow',
  'objectFlow',
  'transition',
  'link',
  'connector',
  'deployment',
  'manifestation',
  'communicationPath',
  'extension',
  'informationFlow',
]);

/** Can an element of `ownerKind` own a child of `childKind`? Relationships are owned by their source. */
export function canOwn(ownerKind: ElementKind, childKind: ElementKind): boolean {
  if (RELATIONSHIP_SET.has(childKind)) return !RELATIONSHIP_SET.has(ownerKind);
  return OWNERSHIP[ownerKind]?.includes(childKind) ?? false;
}

// -------------------------------------------------------------------------------------------------
// Relationship endpoint rules
// -------------------------------------------------------------------------------------------------

const ASSOCIABLE: readonly ElementKind[] = [...CLASSIFIER_KINDS, 'actor', 'useCase', 'node', 'artifact'];
const ACTIVITY_NODES: readonly ElementKind[] = ['action', 'controlNode', 'objectNode'];
const VERTICES: readonly ElementKind[] = ['state', 'pseudostate', 'finalState'];
const DEPENDABLE: readonly ElementKind[] = [
  ...PACKAGEABLE.filter((k) => k !== 'interaction' && k !== 'activity' && k !== 'stateMachine'),
  'port',
  'part',
];
const CONNECTABLE: readonly ElementKind[] = ['part', 'port', 'lifeline', 'component', 'class', 'interface'];
const FLOW_ENDS: readonly ElementKind[] = [
  ...CLASSIFIER_KINDS,
  'actor',
  'node',
  'artifact',
  'useCase',
  'part',
  'informationItem',
];

/** Generalization requires compatible kinds (same metaclass family). */
const GENERALIZABLE: readonly ElementKind[] = [
  ...CLASSIFIER_KINDS,
  'actor',
  'useCase',
  'node',
  'stereotype',
  'artifact',
];

interface EndpointRule {
  sources: readonly ElementKind[];
  targets: readonly ElementKind[];
  sameKind?: boolean;
  allowSelf: boolean;
}

export const RELATIONSHIP_RULES: Record<RelationshipKind, EndpointRule> = {
  association: { sources: ASSOCIABLE, targets: ASSOCIABLE, allowSelf: true },
  generalization: { sources: GENERALIZABLE, targets: GENERALIZABLE, sameKind: true, allowSelf: false },
  realization: {
    sources: ['class', 'component', 'enumeration', 'dataType', 'node', 'artifact'],
    targets: ['interface', 'class', 'component'],
    allowSelf: false,
  },
  dependency: { sources: DEPENDABLE, targets: DEPENDABLE, allowSelf: false },
  include: { sources: ['useCase'], targets: ['useCase'], allowSelf: false },
  extend: { sources: ['useCase'], targets: ['useCase'], allowSelf: false },
  packageImport: { sources: PACKAGE_LIKE, targets: PACKAGE_LIKE, allowSelf: false },
  packageMerge: { sources: PACKAGE_LIKE, targets: PACKAGE_LIKE, allowSelf: false },
  controlFlow: { sources: ACTIVITY_NODES, targets: ACTIVITY_NODES, allowSelf: true },
  objectFlow: { sources: ACTIVITY_NODES, targets: ACTIVITY_NODES, allowSelf: false },
  transition: {
    sources: ['state', 'pseudostate'],
    targets: VERTICES,
    allowSelf: true,
  },
  link: { sources: ['instanceSpecification'], targets: ['instanceSpecification'], allowSelf: true },
  connector: { sources: CONNECTABLE, targets: CONNECTABLE, allowSelf: false },
  deployment: { sources: ['artifact', 'component'], targets: ['node'], allowSelf: false },
  manifestation: {
    sources: ['artifact'],
    targets: [...CLASSIFIER_KINDS, 'artifact'],
    allowSelf: false,
  },
  communicationPath: { sources: ['node'], targets: ['node'], allowSelf: false },
  extension: { sources: ['stereotype'], targets: ['metaclass'], allowSelf: false },
  informationFlow: { sources: FLOW_ENDS, targets: FLOW_ENDS, allowSelf: false },
};

export type EndpointProblem =
  | 'invalidSource'
  | 'invalidTarget'
  | 'selfNotAllowed'
  | 'kindMismatch'
  | 'finalStateSource'
  | 'initialTarget';

export interface EndpointInfo {
  id: string;
  kind: ElementKind;
  /** `pseudoKind` of pseudostates or `nodeKind` of activity control nodes. */
  subKind?: string;
}

/** Endpoint rules, including pseudo-node rules (e.g. nothing may enter an initial node). */
export function checkRelationshipEndpoints(
  kind: RelationshipKind,
  source: EndpointInfo,
  target: EndpointInfo,
): EndpointProblem | null {
  const rule = RELATIONSHIP_RULES[kind];
  if (!rule.sources.includes(source.kind)) return 'invalidSource';
  if (!rule.targets.includes(target.kind)) return 'invalidTarget';
  if (source.id === target.id && !rule.allowSelf) return 'selfNotAllowed';
  if (rule.sameKind && source.kind !== target.kind) return 'kindMismatch';
  if (kind === 'transition') {
    if (target.kind === 'pseudostate' && target.subKind === 'initial') return 'initialTarget';
    if (source.kind === 'pseudostate' && source.subKind === 'terminate') return 'invalidSource';
  }
  if (kind === 'controlFlow' || kind === 'objectFlow') {
    if (target.kind === 'controlNode' && target.subKind === 'initial') return 'initialTarget';
    if (source.kind === 'controlNode' && (source.subKind === 'activityFinal' || source.subKind === 'flowFinal')) {
      return 'finalStateSource';
    }
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// Diagram kinds
// -------------------------------------------------------------------------------------------------

export type RenderMode = 'graph' | 'sequence' | 'none';

export interface DiagramKindInfo {
  kind: DiagramKind;
  renderMode: RenderMode;
  /** Behaviour element created with (and owning) the diagram when the chosen owner is a package. */
  behaviorKind?: 'interaction' | 'activity' | 'stateMachine';
  /** Element kinds allowed to own a diagram of this kind. */
  ownerKinds: readonly ElementKind[];
  /** Semantic kinds that may be shown as node views (graph) or timeline views (sequence). */
  nodeKinds: readonly NodeElementKind[];
  relationshipKinds: readonly RelationshipKind[];
}

const CLASS_NODES: readonly NodeElementKind[] = [
  'package',
  'class',
  'interface',
  'enumeration',
  'dataType',
  'primitiveType',
  'signal',
];

export const DIAGRAM_KIND_INFO: Record<DiagramKind, DiagramKindInfo> = {
  class: {
    kind: 'class',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: CLASS_NODES,
    relationshipKinds: ['association', 'generalization', 'realization', 'dependency'],
  },
  useCase: {
    kind: 'useCase',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['actor', 'useCase', 'subject', 'package'],
    relationshipKinds: ['association', 'generalization', 'include', 'extend', 'dependency'],
  },
  sequence: {
    kind: 'sequence',
    renderMode: 'sequence',
    behaviorKind: 'interaction',
    ownerKinds: ['interaction'],
    nodeKinds: ['lifeline', 'message', 'combinedFragment', 'activation'],
    relationshipKinds: [],
  },
  activity: {
    kind: 'activity',
    renderMode: 'graph',
    behaviorKind: 'activity',
    ownerKinds: ['activity'],
    nodeKinds: ['action', 'controlNode', 'objectNode', 'activityPartition'],
    relationshipKinds: ['controlFlow', 'objectFlow'],
  },
  stateMachine: {
    kind: 'stateMachine',
    renderMode: 'graph',
    behaviorKind: 'stateMachine',
    ownerKinds: ['stateMachine'],
    nodeKinds: ['state', 'pseudostate', 'finalState'],
    relationshipKinds: ['transition'],
  },
  package: {
    kind: 'package',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['package', 'class', 'interface', 'enumeration', 'dataType', 'component'],
    relationshipKinds: ['dependency', 'packageImport', 'packageMerge', 'generalization', 'realization'],
  },
  object: {
    kind: 'object',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['instanceSpecification', 'class', 'package'],
    relationshipKinds: ['link', 'dependency'],
  },
  component: {
    kind: 'component',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['component', 'interface', 'port', 'artifact', 'class', 'package'],
    relationshipKinds: ['dependency', 'realization', 'connector', 'generalization', 'association'],
  },
  deployment: {
    kind: 'deployment',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['node', 'artifact', 'component', 'package'],
    relationshipKinds: ['deployment', 'manifestation', 'communicationPath', 'dependency'],
  },
  compositeStructure: {
    kind: 'compositeStructure',
    renderMode: 'graph',
    ownerKinds: [...PACKAGE_LIKE, 'class', 'component', 'collaboration'],
    nodeKinds: ['class', 'component', 'collaboration', 'part', 'port', 'interface'],
    relationshipKinds: ['connector', 'dependency', 'realization'],
  },
  communication: {
    kind: 'communication',
    renderMode: 'graph',
    behaviorKind: 'interaction',
    ownerKinds: ['interaction'],
    nodeKinds: ['lifeline'],
    relationshipKinds: ['connector'],
  },
  timing: {
    kind: 'timing',
    renderMode: 'none',
    ownerKinds: ['interaction'],
    nodeKinds: [],
    relationshipKinds: [],
  },
  interactionOverview: {
    kind: 'interactionOverview',
    renderMode: 'none',
    ownerKinds: ['activity'],
    nodeKinds: [],
    relationshipKinds: [],
  },
  profile: {
    kind: 'profile',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['profile', 'stereotype', 'metaclass', 'package', 'class'],
    relationshipKinds: ['extension', 'generalization', 'dependency', 'packageImport'],
  },
  informationFlow: {
    kind: 'informationFlow',
    renderMode: 'graph',
    ownerKinds: PACKAGE_LIKE,
    nodeKinds: ['informationItem', 'class', 'actor', 'component', 'node', 'interface', 'package'],
    relationshipKinds: ['informationFlow', 'dependency'],
  },
};

export function diagramAllowsElement(diagramKind: DiagramKind, elementKind: ElementKind): boolean {
  const info = DIAGRAM_KIND_INFO[diagramKind];
  return (info.nodeKinds as readonly string[]).includes(elementKind);
}

export function diagramAllowsRelationship(diagramKind: DiagramKind, kind: RelationshipKind): boolean {
  return DIAGRAM_KIND_INFO[diagramKind].relationshipKinds.includes(kind);
}

// -------------------------------------------------------------------------------------------------
// Visual containment (graph diagrams) and its explicit semantic effect
// -------------------------------------------------------------------------------------------------

/**
 * - `owner`: dropping into the container moves semantic ownership (explicit, undoable transaction).
 * - `partition`: activity partition membership (`partitionId`).
 * - `visual`: diagram-only grouping (e.g. use cases inside a system boundary, spec §3.2).
 */
export type ContainmentEffect = 'owner' | 'partition' | 'visual';

export function containmentEffect(
  containerKind: ElementKind,
  childKind: ElementKind | 'note',
): ContainmentEffect | null {
  if (childKind === 'note') {
    return containerKind === 'activityPartition' ||
      containerKind === 'subject' ||
      PACKAGE_LIKE.includes(containerKind) ||
      containerKind === 'state' ||
      containerKind === 'node' ||
      containerKind === 'component'
      ? 'visual'
      : null;
  }
  switch (containerKind) {
    case 'model':
    case 'package':
    case 'profile':
      return canOwn(containerKind, childKind) ? 'owner' : null;
    case 'subject':
      return childKind === 'useCase' ? 'visual' : null;
    case 'activityPartition':
      return ACTIVITY_NODES.includes(childKind) ? 'partition' : null;
    case 'state':
      return VERTICES.includes(childKind) ? 'owner' : null;
    case 'component':
      return canOwn('component', childKind) ? 'owner' : null;
    case 'class':
    case 'collaboration':
      return childKind === 'part' || (childKind === 'port' && containerKind === 'class') ? 'owner' : null;
    case 'node':
      if (childKind === 'node') return 'owner';
      return childKind === 'artifact' || childKind === 'component' ? 'visual' : null;
    default:
      return null;
  }
}

/** Kinds whose views may act as visual containers. */
export const CONTAINER_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  'model',
  'package',
  'profile',
  'subject',
  'activityPartition',
  'state',
  'component',
  'class',
  'collaboration',
  'node',
]);

/** Kinds whose semantic identity is tied to the diagram they are drawn in. */
export const DIAGRAM_SCOPED_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  'lifeline',
  'message',
  'combinedFragment',
  'activation',
  ...(RELATIONSHIP_SET as Set<ElementKind>),
]);
