import type * as z from 'zod';
import type { IdGenerator } from '../ids';
import type { ID } from '../schemas/common';
import { ELEMENT_SCHEMAS, type ElementInput, type ElementKind, type ElementOf } from '../schemas/elements';
import {
  AttributeSchema,
  CommunicationMessageSchema,
  EnumerationLiteralSchema,
  ExtensionPointSchema,
  InteractionOperandSchema,
  OperationSchema,
  ParameterSchema,
  SlotSchema,
  TagDefinitionSchema,
  type Attribute,
  type CommunicationMessage,
  type EnumerationLiteral,
  type ExtensionPoint,
  type InteractionOperand,
  type Operation,
  type Parameter,
  type Slot,
  type TagDefinition,
} from '../schemas/members';
import {
  CURRENT_SCHEMA_VERSION,
  DiagramSchema,
  PROJECT_FORMAT,
  ProjectDocumentSchema,
  type DiagramKind,
  type ProjectDocument,
  type UMLDiagram,
} from '../schemas/project';
import { VIEW_SCHEMAS, type ViewInput, type ViewKind, type ViewOf } from '../schemas/views';

/**
 * Factories run the Zod schema so every created object is in canonical (fully defaulted) form.
 * This keeps the in-memory document identical to what a save → load round trip produces.
 */

export function makeElement<K extends ElementKind>(kind: K, init: ElementInput<K>): ElementOf<K> {
  const schema = ELEMENT_SCHEMAS[kind] as unknown as z.ZodType<ElementOf<K>>;
  return schema.parse({ ...init, kind });
}

export function makeView<K extends ViewKind>(kind: K, init: ViewInput<K>): ViewOf<K> {
  const schema = VIEW_SCHEMAS[kind] as unknown as z.ZodType<ViewOf<K>>;
  return schema.parse({ ...init, kind });
}

export function makeDiagram(init: {
  id: ID;
  kind: DiagramKind;
  name: string;
  ownerId: ID;
  documentation?: string;
}): UMLDiagram {
  return DiagramSchema.parse({ ...init, views: {} });
}

export const makeAttribute = (init: z.input<typeof AttributeSchema>): Attribute => AttributeSchema.parse(init);
export const makeOperation = (init: z.input<typeof OperationSchema>): Operation => OperationSchema.parse(init);
export const makeParameter = (init: z.input<typeof ParameterSchema>): Parameter => ParameterSchema.parse(init);
export const makeLiteral = (init: z.input<typeof EnumerationLiteralSchema>): EnumerationLiteral =>
  EnumerationLiteralSchema.parse(init);
export const makeExtensionPoint = (init: z.input<typeof ExtensionPointSchema>): ExtensionPoint =>
  ExtensionPointSchema.parse(init);
export const makeOperand = (init: z.input<typeof InteractionOperandSchema>): InteractionOperand =>
  InteractionOperandSchema.parse(init);
export const makeSlot = (init: z.input<typeof SlotSchema>): Slot => SlotSchema.parse(init);
export const makeTagDefinition = (init: z.input<typeof TagDefinitionSchema>): TagDefinition =>
  TagDefinitionSchema.parse(init);
export const makeCommunicationMessage = (init: z.input<typeof CommunicationMessageSchema>): CommunicationMessage =>
  CommunicationMessageSchema.parse(init);

export interface NewProjectOptions {
  name: string;
  modelName?: string;
  description?: string;
  ids: IdGenerator;
  now: Date;
}

/** A blank project: one root model, no diagrams. */
export function createEmptyProject(options: NewProjectOptions): ProjectDocument {
  const rootId = options.ids.next();
  const timestamp = options.now.toISOString();
  return ProjectDocumentSchema.parse({
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.ids.next(),
    name: options.name,
    description: options.description ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
    rootModelId: rootId,
    modelElements: {
      [rootId]: makeElement('model', { id: rootId, name: options.modelName ?? 'Model', ownerId: null }),
    },
    diagrams: {},
  });
}
