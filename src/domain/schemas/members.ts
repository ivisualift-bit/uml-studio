import * as z from 'zod';
import { IdSchema, NameSchema, ShortTextSchema, VisibilitySchema } from './common';

/**
 * Owned value objects (features). They are not model elements (no owner/views) but carry their own
 * globally unique IDs so that edits, reordering and undo are stable and references can target them.
 */

export const AttributeSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  type: ShortTextSchema.default(''),
  typeElementId: IdSchema.nullable().default(null),
  visibility: VisibilitySchema.default('public'),
  multiplicity: z.string().max(50).default(''),
  defaultValue: ShortTextSchema.default(''),
  isStatic: z.boolean().default(false),
  isReadOnly: z.boolean().default(false),
  isDerived: z.boolean().default(false),
  isOrdered: z.boolean().default(false),
  isUnique: z.boolean().default(true),
});
export type Attribute = z.infer<typeof AttributeSchema>;

export const ParameterDirectionSchema = z.enum(['in', 'out', 'inout', 'return']);
export type ParameterDirection = z.infer<typeof ParameterDirectionSchema>;

export const ParameterSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  type: ShortTextSchema.default(''),
  typeElementId: IdSchema.nullable().default(null),
  direction: ParameterDirectionSchema.default('in'),
  multiplicity: z.string().max(50).default(''),
  defaultValue: ShortTextSchema.default(''),
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const OperationSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  visibility: VisibilitySchema.default('public'),
  returnType: ShortTextSchema.default(''),
  returnTypeElementId: IdSchema.nullable().default(null),
  isStatic: z.boolean().default(false),
  isAbstract: z.boolean().default(false),
  isQuery: z.boolean().default(false),
  parameters: z.array(ParameterSchema).max(200).default([]),
});
export type Operation = z.infer<typeof OperationSchema>;

export const EnumerationLiteralSchema = z.object({ id: IdSchema, name: NameSchema });
export type EnumerationLiteral = z.infer<typeof EnumerationLiteralSchema>;

export const ExtensionPointSchema = z.object({ id: IdSchema, name: NameSchema });
export type ExtensionPoint = z.infer<typeof ExtensionPointSchema>;

export const InteractionOperandSchema = z.object({ id: IdSchema, guard: ShortTextSchema.default('') });
export type InteractionOperand = z.infer<typeof InteractionOperandSchema>;

export const SlotSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  value: ShortTextSchema.default(''),
  definingFeatureId: IdSchema.nullable().default(null),
});
export type Slot = z.infer<typeof SlotSchema>;

export const TagDefinitionSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  type: z.enum(['string', 'integer', 'boolean', 'real']).default('string'),
  defaultValue: ShortTextSchema.default(''),
});
export type TagDefinition = z.infer<typeof TagDefinitionSchema>;

export const MessageSortSchema = z.enum(['synchronous', 'asynchronous', 'reply', 'create', 'destroy']);
export type MessageSort = z.infer<typeof MessageSortSchema>;

/** Numbered message carried by a communication-diagram link (connector). */
export const CommunicationMessageSchema = z.object({
  id: IdSchema,
  sequence: z.string().max(50).default(''),
  name: NameSchema,
  direction: z.enum(['forward', 'backward']).default('forward'),
  sort: z.enum(['synchronous', 'asynchronous', 'reply']).default('synchronous'),
});
export type CommunicationMessage = z.infer<typeof CommunicationMessageSchema>;

export const AppliedStereotypeSchema = z.object({
  id: IdSchema,
  stereotypeId: IdSchema,
  values: z.record(z.string().max(100), z.string().max(1000)).default({}),
});
export type AppliedStereotype = z.infer<typeof AppliedStereotypeSchema>;
