import * as z from 'zod';
import { ColorSchema, CoordinateSchema, IdSchema, PointSchema, SizeSchema } from './common';

export const ViewStyleSchema = z.object({
  fill: ColorSchema.optional(),
  stroke: ColorSchema.optional(),
  textColor: ColorSchema.optional(),
  fontSize: z.number().min(6).max(72).optional(),
  lineWidth: z.number().min(0.5).max(8).optional(),
});
export type ViewStyle = z.infer<typeof ViewStyleSchema>;

export const CompartmentSchema = z.enum([
  'attributes',
  'operations',
  'literals',
  'internalActivities',
  'slots',
  'extensionPoints',
  'tagDefinitions',
]);
export type Compartment = z.infer<typeof CompartmentSchema>;

const style = ViewStyleSchema.prefault({});

/** Generic graph node view of a semantic element. Coordinates are absolute diagram coordinates. */
export const NodeViewSchema = z.object({
  kind: z.literal('node'),
  id: IdSchema,
  elementId: IdSchema,
  x: CoordinateSchema,
  y: CoordinateSchema,
  width: SizeSchema,
  height: SizeSchema,
  /** Visual container (package, boundary, swimlane, composite state…) in the same diagram. */
  containerViewId: IdSchema.nullable().default(null),
  style,
  hiddenCompartments: z.array(CompartmentSchema).max(10).default([]),
  /** Alternative notation (actor as «actor» box, interface as lollipop…). */
  variant: z.enum(['default', 'alternate']).default('default'),
});
export type NodeView = z.infer<typeof NodeViewSchema>;

export const EdgeLabelKeySchema = z.enum([
  'name',
  'stereotype',
  'sourceRole',
  'sourceMultiplicity',
  'targetRole',
  'targetMultiplicity',
]);
export type EdgeLabelKey = z.infer<typeof EdgeLabelKeySchema>;

export const RoutingSchema = z.enum(['straight', 'orthogonal']);
export type Routing = z.infer<typeof RoutingSchema>;

/** Graph edge view of a semantic relationship between two node views of the same diagram. */
export const EdgeViewSchema = z.object({
  kind: z.literal('edge'),
  id: IdSchema,
  elementId: IdSchema,
  sourceViewId: IdSchema,
  targetViewId: IdSchema,
  waypoints: z.array(PointSchema).max(200).default([]),
  routing: RoutingSchema.default('straight'),
  /** User drag offsets relative to each label's computed default position. */
  labelOffsets: z.partialRecord(EdgeLabelKeySchema, PointSchema).default({}),
  style,
});
export type EdgeView = z.infer<typeof EdgeViewSchema>;

/** Presentation-only annotation (no semantic element), allowed in every diagram. */
export const NoteViewSchema = z.object({
  kind: z.literal('note'),
  id: IdSchema,
  text: z.string().max(20_000).default(''),
  x: CoordinateSchema,
  y: CoordinateSchema,
  width: SizeSchema,
  height: SizeSchema,
  containerViewId: IdSchema.nullable().default(null),
  style,
});
export type NoteView = z.infer<typeof NoteViewSchema>;

/** Dashed anchor line between a note and another view (presentation-only). */
export const NoteLinkViewSchema = z.object({
  kind: z.literal('noteLink'),
  id: IdSchema,
  sourceViewId: IdSchema,
  targetViewId: IdSchema,
  waypoints: z.array(PointSchema).max(200).default([]),
  style,
});
export type NoteLinkView = z.infer<typeof NoteLinkViewSchema>;

// ------------------------------------------------------------------------------------------------
// Sequence timeline views — vertical positions encode time and drive message ordering.
// ------------------------------------------------------------------------------------------------

export const LifelineViewSchema = z.object({
  kind: z.literal('lifeline'),
  id: IdSchema,
  elementId: IdSchema,
  /** Horizontal centre of the lifeline. */
  x: CoordinateSchema,
  /** Top of the head box (a created lifeline's head is drawn at its create message instead). */
  y: CoordinateSchema,
  width: SizeSchema,
  headHeight: SizeSchema,
  style,
});
export type LifelineView = z.infer<typeof LifelineViewSchema>;

export const MessageViewSchema = z.object({
  kind: z.literal('message'),
  id: IdSchema,
  elementId: IdSchema,
  /** Lifeline view of the sender; `null` for a found message. */
  sourceViewId: IdSchema.nullable(),
  /** Lifeline view of the receiver; `null` for a lost message. */
  targetViewId: IdSchema.nullable(),
  sendY: CoordinateSchema,
  receiveY: CoordinateSchema,
  labelOffset: PointSchema.prefault({ x: 0, y: 0 }),
  style,
});
export type MessageView = z.infer<typeof MessageViewSchema>;

export const ActivationViewSchema = z.object({
  kind: z.literal('activation'),
  id: IdSchema,
  elementId: IdSchema,
  lifelineViewId: IdSchema,
  startY: CoordinateSchema,
  endY: CoordinateSchema,
  style,
});
export type ActivationView = z.infer<typeof ActivationViewSchema>;

export const FragmentViewSchema = z.object({
  kind: z.literal('fragment'),
  id: IdSchema,
  elementId: IdSchema,
  x: CoordinateSchema,
  y: CoordinateSchema,
  width: SizeSchema,
  height: SizeSchema,
  /** Top Y of every operand except the first (keyed by operand ID). */
  operandYs: z.record(IdSchema, CoordinateSchema).default({}),
  style,
});
export type FragmentView = z.infer<typeof FragmentViewSchema>;

export const DiagramViewSchema = z.discriminatedUnion('kind', [
  NodeViewSchema,
  EdgeViewSchema,
  NoteViewSchema,
  NoteLinkViewSchema,
  LifelineViewSchema,
  MessageViewSchema,
  ActivationViewSchema,
  FragmentViewSchema,
]);
export type DiagramView = z.infer<typeof DiagramViewSchema>;
export type ViewKind = DiagramView['kind'];
export type ViewOf<K extends ViewKind> = Extract<DiagramView, { kind: K }>;

export const VIEW_SCHEMAS = {
  node: NodeViewSchema,
  edge: EdgeViewSchema,
  note: NoteViewSchema,
  noteLink: NoteLinkViewSchema,
  lifeline: LifelineViewSchema,
  message: MessageViewSchema,
  activation: ActivationViewSchema,
  fragment: FragmentViewSchema,
} as const;
export type ViewInput<K extends ViewKind> = Omit<z.input<(typeof VIEW_SCHEMAS)[K]>, 'kind'>;

/** Views with a rectangular box (used for selection bounds, alignment, containment). */
export type BoxView = NodeView | NoteView;
export function isBoxView(view: DiagramView): view is BoxView {
  return view.kind === 'node' || view.kind === 'note';
}
