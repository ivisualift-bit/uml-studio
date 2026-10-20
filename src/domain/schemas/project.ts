import * as z from 'zod';
import { IdSchema, LongTextSchema, NameSchema, VisibilitySchema } from './common';
import { ModelElementSchema } from './elements';
import { DiagramViewSchema } from './views';

export const PROJECT_FORMAT = 'uml-studio-project';
export const CURRENT_SCHEMA_VERSION = 1;

export const DIAGRAM_KINDS = [
  'class',
  'useCase',
  'sequence',
  'activity',
  'stateMachine',
  'package',
  'object',
  'component',
  'deployment',
  'compositeStructure',
  'communication',
  'timing',
  'interactionOverview',
  'profile',
  'informationFlow',
] as const;
export const DiagramKindSchema = z.enum(DIAGRAM_KINDS);
export type DiagramKind = z.infer<typeof DiagramKindSchema>;

export const DiagramOptionsSchema = z.object({
  showVisibility: z.boolean().default(true),
  showAttributeTypes: z.boolean().default(true),
  showOperationSignatures: z.boolean().default(true),
  showMessageNumbers: z.boolean().default(false),
  /** Default routing style for newly created edges. */
  defaultRouting: z.enum(['straight', 'orthogonal']).default('straight'),
});
export type DiagramOptions = z.infer<typeof DiagramOptionsSchema>;

export const ViewportSchema = z.object({
  x: z.number().min(-10_000_000).max(10_000_000),
  y: z.number().min(-10_000_000).max(10_000_000),
  zoom: z.number().min(0.05).max(8),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const DiagramSchema = z.object({
  id: IdSchema,
  kind: DiagramKindSchema,
  name: NameSchema,
  ownerId: IdSchema,
  documentation: LongTextSchema.default(''),
  /** Insertion order = z-order (later entries draw on top). */
  views: z.record(IdSchema, DiagramViewSchema).default({}),
  viewport: ViewportSchema.nullable().default(null),
  options: DiagramOptionsSchema.prefault({}),
});
export type UMLDiagram = z.infer<typeof DiagramSchema>;

export const ProjectSettingsSchema = z.object({
  defaultAttributeVisibility: VisibilitySchema.default('private'),
  defaultOperationVisibility: VisibilitySchema.default('public'),
  gridSize: z.number().int().min(2).max(100).default(10),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** Namespaced extension data (e.g. `"acme.tool:layout"`) preserved verbatim across load/save. */
export const ExtensionsSchema = z.record(z.string().regex(/^[a-z0-9.-]+:[A-Za-z0-9._-]+$/), z.json());

export const ProjectDocumentSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  name: NameSchema,
  description: LongTextSchema.default(''),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  rootModelId: IdSchema,
  modelElements: z.record(IdSchema, ModelElementSchema),
  diagrams: z.record(IdSchema, DiagramSchema),
  settings: ProjectSettingsSchema.prefault({}),
  extensions: ExtensionsSchema.default({}),
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
