import { CURRENT_SCHEMA_VERSION } from '../schemas/project';
import { isPlainObject } from '../util';

/**
 * Schema migrations. Each step upgrades a raw (still untrusted, pre-validation) document from
 * version N to N+1. Version 1 is the first released format, so the production chain is empty;
 * the mechanism is exercised by unit tests with injected steps.
 */
export interface Migration {
  from: number;
  to: number;
  description: string;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

export const MIGRATIONS: readonly Migration[] = [];

export type MigrationOutcome =
  | { ok: true; raw: Record<string, unknown>; applied: string[] }
  | { ok: false; reason: 'newer' | 'unknown-version' | 'gap'; version: number | null };

export function migrateToCurrent(
  raw: Record<string, unknown>,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationOutcome {
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, reason: 'unknown-version', version: null };
  }
  if (version > target) return { ok: false, reason: 'newer', version };
  let current: Record<string, unknown> = raw;
  let v = version;
  const applied: string[] = [];
  while (v < target) {
    const step = migrations.find((m) => m.from === v);
    if (!step || step.to !== v + 1) return { ok: false, reason: 'gap', version: v };
    const next = step.migrate(structuredClone(current));
    if (!isPlainObject(next)) return { ok: false, reason: 'gap', version: v };
    current = { ...next, schemaVersion: step.to };
    applied.push(`${step.from}→${step.to}: ${step.description}`);
    v = step.to;
  }
  return { ok: true, raw: current, applied };
}
