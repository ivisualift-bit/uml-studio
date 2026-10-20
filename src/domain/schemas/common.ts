import * as z from 'zod';

/** Opaque stable identifier. UUIDs in practice; templates use readable deterministic IDs. */
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiers may only contain letters, digits, "-" and "_"');
export type ID = z.infer<typeof IdSchema>;

export const NameSchema = z.string().max(1000);
export const ShortTextSchema = z.string().max(1000);
export const LongTextSchema = z.string().max(100_000);

/** Diagram coordinates are bounded to keep geometry/export sane and reject absurd imported values. */
export const CoordinateSchema = z.number().min(-1_000_000).max(1_000_000);
export const SizeSchema = z.number().min(1).max(100_000);

export const PointSchema = z.object({ x: CoordinateSchema, y: CoordinateSchema });
export type Point = z.infer<typeof PointSchema>;

export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colors use the #rrggbb format');

export const VisibilitySchema = z.enum(['public', 'private', 'protected', 'package']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const TaggedValuesSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(1000), z.number(), z.boolean()]),
);
