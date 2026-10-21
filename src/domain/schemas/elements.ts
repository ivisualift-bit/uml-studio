import * as z from 'zod';
import {
  IdSchema,
  LongTextSchema,
  NameSchema,
  ShortTextSchema,
  TaggedValuesSchema,
  VisibilitySchema,
} from './common';
import {
  AppliedStereotypeSchema,
  AttributeSchema,
  CommunicationMessageSchema,
  EnumerationLiteralSchema,
  ExtensionPointSchema,
  InteractionOperandSchema,
  MessageSortSchema,
  OperationSchema,
  SlotSchema,
  TagDefinitionSchema,
} from './members';

/** Fields shared by every semantic model element. */
const base = {
  id: IdSchema,
  name: NameSchema,
  ownerId: IdSchema.nullable(),
  documentation: LongTextSchema.default(''),
  /** Free-text keyword(s) rendered as «stereotype». Profile stereotypes use `appliedStereotypes`. */
  stereotype: z.string().max(200).default(''),
  appliedStereotypes: z.array(AppliedStereotypeSchema).max(50).default([]),
  taggedValues: TaggedValuesSchema.default({}),
};

const features = {
  isAbstract: z.boolean().default(false),
  isLeaf: z.boolean().default(false),
  visibility: VisibilitySchema.default('public'),
  attributes: z.array(AttributeSchema).max(500).default([]),
  operations: z.array(OperationSchema).max(500).default([]),
};

const el = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ kind: z.literal(kind), ...base, ...shape });

// ---------------------------------------------------------------------------------------------
// Containers / packaging
// ---------------------------------------------------------------------------------------------
export const ModelSchema = el('model', {});
export const PackageSchema = el('package', { visibility: VisibilitySchema.default('public') });
export const ProfileSchema = el('profile', {});

// ---------------------------------------------------------------------------------------------
// Classifiers (class diagram family)
// ---------------------------------------------------------------------------------------------
export const ClassSchema = el('class', { ...features, isActive: z.boolean().default(false) });
export const InterfaceSchema = el('interface', features);
export const EnumerationSchema = el('enumeration', {
  ...features,
  literals: z.array(EnumerationLiteralSchema).max(1000).default([]),
});
export const DataTypeSchema = el('dataType', features);
export const PrimitiveTypeSchema = el('primitiveType', features);
export const SignalSchema = el('signal', features);

// ---------------------------------------------------------------------------------------------
// Instances (object diagram)
// ---------------------------------------------------------------------------------------------
export const InstanceSpecificationSchema = el('instanceSpecification', {
  classifierId: IdSchema.nullable().default(null),
  /** Free text classifier name used when no semantic classifier is referenced. */
  classifierName: ShortTextSchema.default(''),
  slots: z.array(SlotSchema).max(500).default([]),
});

// ---------------------------------------------------------------------------------------------
// Components, deployment, composite structure
// ---------------------------------------------------------------------------------------------
export const ComponentSchema = el('component', features);
export const ArtifactSchema = el('artifact', { fileName: ShortTextSchema.default('') });
export const PortSchema = el('port', {
  typeName: ShortTextSchema.default(''),
  typeElementId: IdSchema.nullable().default(null),
  isService: z.boolean().default(true),
  isBehavior: z.boolean().default(false),
  multiplicity: z.string().max(50).default(''),
});
export const PartSchema = el('part', {
  typeName: ShortTextSchema.default(''),
  typeElementId: IdSchema.nullable().default(null),
  multiplicity: z.string().max(50).default(''),
  aggregation: z.enum(['none', 'shared', 'composite']).default('composite'),
});
export const CollaborationSchema = el('collaboration', {});
export const DeploymentNodeKindSchema = z.enum(['node', 'device', 'executionEnvironment']);
export const NodeSchema = el('node', { nodeKind: DeploymentNodeKindSchema.default('node') });

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------
export const StereotypeSchema = el('stereotype', {
  tagDefinitions: z.array(TagDefinitionSchema).max(200).default([]),
});
export const MetaclassSchema = el('metaclass', {});

// ---------------------------------------------------------------------------------------------
// Information flow
// ---------------------------------------------------------------------------------------------
export const InformationItemSchema = el('informationItem', {});

// ---------------------------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------------------------
export const ActorSchema = el('actor', { isAbstract: z.boolean().default(false) });
export const UseCaseSchema = el('useCase', {
  isAbstract: z.boolean().default(false),
  extensionPoints: z.array(ExtensionPointSchema).max(200).default([]),
});
/** System boundary ("subject"). Visual containment of use cases is NOT ownership (spec §3.2). */
export const SubjectSchema = el('subject', {});

// ---------------------------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------------------------
export const ActivitySchema = el('activity', {});
export const ActionKindSchema = z.enum([
  'opaque',
  'callBehavior',
  'sendSignal',
  'acceptEvent',
  'acceptTimeEvent',
]);
export const ActionSchema = el('action', {
  actionKind: ActionKindSchema.default('opaque'),
  partitionId: IdSchema.nullable().default(null),
});
export const ControlNodeKindSchema = z.enum([
  'initial',
  'activityFinal',
  'flowFinal',
  'decision',
  'merge',
  'fork',
  'join',
]);
export const ControlNodeSchema = el('controlNode', {
  nodeKind: ControlNodeKindSchema,
  partitionId: IdSchema.nullable().default(null),
});
export const ObjectNodeSchema = el('objectNode', {
  typeName: ShortTextSchema.default(''),
  typeElementId: IdSchema.nullable().default(null),
  partitionId: IdSchema.nullable().default(null),
});
export const ActivityPartitionSchema = el('activityPartition', {});

// ---------------------------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------------------------
export const StateMachineSchema = el('stateMachine', {});
export const StateSchema = el('state', {
  entry: ShortTextSchema.default(''),
  doActivity: ShortTextSchema.default(''),
  exit: ShortTextSchema.default(''),
});
export const PseudostateKindSchema = z.enum([
  'initial',
  'choice',
  'junction',
  'fork',
  'join',
  'shallowHistory',
  'deepHistory',
  'terminate',
  'entryPoint',
  'exitPoint',
]);
export const PseudostateSchema = el('pseudostate', { pseudoKind: PseudostateKindSchema });
export const FinalStateSchema = el('finalState', {});

// ---------------------------------------------------------------------------------------------
// Interactions (sequence / communication)
// ---------------------------------------------------------------------------------------------
export const InteractionSchema = el('interaction', {});
export const LifelineSchema = el('lifeline', {
  typeElementId: IdSchema.nullable().default(null),
  typeName: ShortTextSchema.default(''),
  headStyle: z.enum(['object', 'actor']).default('object'),
});
export const MessageSchema = el('message', {
  /** `null` = found message (no known sender). */
  sourceLifelineId: IdSchema.nullable(),
  /** `null` = lost message (no known receiver). */
  targetLifelineId: IdSchema.nullable(),
  sort: MessageSortSchema.default('synchronous'),
  arguments: ShortTextSchema.default(''),
  guard: ShortTextSchema.default(''),
});
export const FragmentOperatorSchema = z.enum([
  'alt',
  'opt',
  'loop',
  'par',
  'break',
  'critical',
  'neg',
  'assert',
  'strict',
  'seq',
  'ignore',
  'consider',
  'ref',
]);
export type FragmentOperator = z.infer<typeof FragmentOperatorSchema>;
export const CombinedFragmentSchema = el('combinedFragment', {
  operator: FragmentOperatorSchema.default('alt'),
  operands: z.array(InteractionOperandSchema).min(1).max(50),
});
/** Execution specification ("activation bar") on a lifeline. */
export const ActivationSchema = el('activation', { lifelineId: IdSchema });

// ---------------------------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------------------------
export const AggregationKindSchema = z.enum(['none', 'shared', 'composite']);
export const NavigabilitySchema = z.enum(['unspecified', 'navigable', 'nonNavigable']);
export const RelationEndSchema = z.object({
  name: NameSchema.default(''),
  multiplicity: z.string().max(50).default(''),
  navigability: NavigabilitySchema.default('unspecified'),
  aggregation: AggregationKindSchema.default('none'),
  visibility: VisibilitySchema.default('public'),
  isOrdered: z.boolean().default(false),
  isUnique: z.boolean().default(true),
});
export type RelationEnd = z.infer<typeof RelationEndSchema>;

const rel = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  el(kind, { sourceId: IdSchema, targetId: IdSchema, ...shape });

const ends = { sourceEnd: RelationEndSchema.prefault({}), targetEnd: RelationEndSchema.prefault({}) };

export const AssociationSchema = rel('association', { ...ends, isDerived: z.boolean().default(false) });
export const GeneralizationSchema = rel('generalization', {});
export const RealizationSchema = rel('realization', {});
export const DependencySchema = rel('dependency', {});
export const IncludeSchema = rel('include', {});
export const ExtendSchema = rel('extend', {
  condition: ShortTextSchema.default(''),
  extensionPointIds: z.array(IdSchema).max(100).default([]),
});
export const PackageImportSchema = rel('packageImport', {});
export const PackageMergeSchema = rel('packageMerge', {});
export const ControlFlowSchema = rel('controlFlow', {
  guard: ShortTextSchema.default(''),
  weight: z.string().max(100).default(''),
});
export const ObjectFlowSchema = rel('objectFlow', {
  guard: ShortTextSchema.default(''),
  weight: z.string().max(100).default(''),
});
export const TransitionSchema = rel('transition', {
  trigger: ShortTextSchema.default(''),
  guard: ShortTextSchema.default(''),
  effect: ShortTextSchema.default(''),
  transitionKind: z.enum(['external', 'internal', 'local']).default('external'),
});
export const LinkSchema = rel('link', { ...ends, associationId: IdSchema.nullable().default(null) });
export const ConnectorSchema = rel('connector', {
  ...ends,
  connectorKind: z.enum(['assembly', 'delegation', 'basic']).default('basic'),
  messages: z.array(CommunicationMessageSchema).max(500).default([]),
});
export const DeploymentSchema = rel('deployment', {});
export const ManifestationSchema = rel('manifestation', {});
export const CommunicationPathSchema = rel('communicationPath', ends);
export const ExtensionSchema = rel('extension', { isRequired: z.boolean().default(false) });
export const InformationFlowSchema = rel('informationFlow', {
  conveyedIds: z.array(IdSchema).max(100).default([]),
});

export const RELATIONSHIP_SCHEMAS = {
  association: AssociationSchema,
  generalization: GeneralizationSchema,
  realization: RealizationSchema,
  dependency: DependencySchema,
  include: IncludeSchema,
  extend: ExtendSchema,
  packageImport: PackageImportSchema,
  packageMerge: PackageMergeSchema,
  controlFlow: ControlFlowSchema,
  objectFlow: ObjectFlowSchema,
  transition: TransitionSchema,
  link: LinkSchema,
  connector: ConnectorSchema,
  deployment: DeploymentSchema,
  manifestation: ManifestationSchema,
  communicationPath: CommunicationPathSchema,
  extension: ExtensionSchema,
  informationFlow: InformationFlowSchema,
} as const;

export const NODE_ELEMENT_SCHEMAS = {
  model: ModelSchema,
  package: PackageSchema,
  profile: ProfileSchema,
  class: ClassSchema,
  interface: InterfaceSchema,
  enumeration: EnumerationSchema,
  dataType: DataTypeSchema,
  primitiveType: PrimitiveTypeSchema,
  signal: SignalSchema,
  instanceSpecification: InstanceSpecificationSchema,
  component: ComponentSchema,
  artifact: ArtifactSchema,
  port: PortSchema,
  part: PartSchema,
  collaboration: CollaborationSchema,
  node: NodeSchema,
  stereotype: StereotypeSchema,
  metaclass: MetaclassSchema,
  informationItem: InformationItemSchema,
  actor: ActorSchema,
  useCase: UseCaseSchema,
  subject: SubjectSchema,
  activity: ActivitySchema,
  action: ActionSchema,
  controlNode: ControlNodeSchema,
  objectNode: ObjectNodeSchema,
  activityPartition: ActivityPartitionSchema,
  stateMachine: StateMachineSchema,
  state: StateSchema,
  pseudostate: PseudostateSchema,
  finalState: FinalStateSchema,
  interaction: InteractionSchema,
  lifeline: LifelineSchema,
  message: MessageSchema,
  combinedFragment: CombinedFragmentSchema,
  activation: ActivationSchema,
} as const;

export const ELEMENT_SCHEMAS = { ...NODE_ELEMENT_SCHEMAS, ...RELATIONSHIP_SCHEMAS } as const;

type SchemaMap = typeof ELEMENT_SCHEMAS;
export type ElementKind = keyof SchemaMap;
export type RelationshipKind = keyof typeof RELATIONSHIP_SCHEMAS;
export type NodeElementKind = keyof typeof NODE_ELEMENT_SCHEMAS;

const schemaList = Object.values(ELEMENT_SCHEMAS) as unknown as [
  SchemaMap[ElementKind],
  ...SchemaMap[ElementKind][],
];
export const ModelElementSchema = z.discriminatedUnion('kind', schemaList);

export type ModelElement = z.infer<typeof ModelElementSchema>;
export type ElementOf<K extends ElementKind> = Extract<ModelElement, { kind: K }>;
export type ElementInput<K extends ElementKind> = Omit<z.input<SchemaMap[K]>, 'kind'>;
export type Relationship = ElementOf<RelationshipKind>;

export const RELATIONSHIP_KINDS = Object.keys(RELATIONSHIP_SCHEMAS) as RelationshipKind[];
export const ELEMENT_KINDS = Object.keys(ELEMENT_SCHEMAS) as ElementKind[];

const relationshipKindSet = new Set<string>(RELATIONSHIP_KINDS);
export function isRelationship(element: ModelElement): element is Relationship {
  return relationshipKindSet.has(element.kind);
}
export function isRelationshipKind(kind: string): kind is RelationshipKind {
  return relationshipKindSet.has(kind);
}

export type ClassifierWithFeatures = ElementOf<
  'class' | 'interface' | 'enumeration' | 'dataType' | 'primitiveType' | 'signal' | 'component'
>;
const featureKinds = new Set<string>([
  'class',
  'interface',
  'enumeration',
  'dataType',
  'primitiveType',
  'signal',
  'component',
]);
export function hasFeatures(element: ModelElement): element is ClassifierWithFeatures {
  return featureKinds.has(element.kind);
}

export type ElementWithPartition = ElementOf<'action' | 'controlNode' | 'objectNode'>;
export function hasPartition(element: ModelElement): element is ElementWithPartition {
  return element.kind === 'action' || element.kind === 'controlNode' || element.kind === 'objectNode';
}
