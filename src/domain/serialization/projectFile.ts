import { PROJECT_FORMAT, ProjectDocumentSchema, type ProjectDocument } from '../schemas/project';
import { checkIntegrity } from '../services/integrity';
import { isPlainObject } from '../util';
import { scanJson } from './jsonScan';
import { migrateToCurrent, MIGRATIONS, type Migration } from './migrations';

export const PROJECT_FILE_EXTENSION = 'umls';
export const PROJECT_MIME_TYPE = 'application/vnd.umlstudio.project+json';
export const MAX_PROJECT_BYTES = 25 * 1024 * 1024;

/** Canonical serialization: normalized through the schema (stable key order), 2-space JSON, LF. */
export function serializeProject(doc: ProjectDocument): string {
  const normalized = ProjectDocumentSchema.parse(doc);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export type LoadErrorCode =
  | 'tooLarge'
  | 'empty'
  | 'tooDeep'
  | 'duplicateKeys'
  | 'invalidJson'
  | 'notAProject'
  | 'newerVersion'
  | 'unsupportedVersion'
  | 'schema'
  | 'integrity';

export interface LoadError {
  code: LoadErrorCode;
  /** Human-readable diagnostics (English, technical); the UI shows a localized summary + these. */
  details: string[];
  version?: number | null;
}

export type LoadResult =
  { ok: true; doc: ProjectDocument; migrations: string[] } | { ok: false; error: LoadError };

export interface LoadOptions {
  maxBytes?: number;
  migrations?: readonly Migration[];
}

/** Byte length of a UTF-8 string without allocating an encoder for small inputs. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Untrusted text → validated project. Never throws; never mutates anything outside its result.
 * Pipeline: size → structure scan → JSON.parse → format/version → migrations → Zod → integrity.
 */
export function parseProjectText(text: string, options: LoadOptions = {}): LoadResult {
  const maxBytes = options.maxBytes ?? MAX_PROJECT_BYTES;
  const fail = (code: LoadErrorCode, details: string[] = [], version?: number | null): LoadResult => ({
    ok: false,
    error: { code, details, version },
  });
  if (text.length > maxBytes || utf8Length(text) > maxBytes) {
    return fail('tooLarge', [`File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`]);
  }
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return fail('empty');
  const scan = scanJson(trimmed);
  if (scan.maxDepthExceeded) return fail('tooDeep', ['JSON nesting is too deep']);
  if (scan.duplicateKeys.length) {
    return fail(
      'duplicateKeys',
      scan.duplicateKeys.map((k) => `Duplicate key "${k}"`),
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (error) {
    return fail('invalidJson', [error instanceof Error ? error.message : String(error)]);
  }
  if (!isPlainObject(raw) || raw.format !== PROJECT_FORMAT) {
    return fail('notAProject', ['Missing "format": "uml-studio-project" marker']);
  }
  const migrated = migrateToCurrent(raw, options.migrations ?? MIGRATIONS);
  if (!migrated.ok) {
    if (migrated.reason === 'newer') {
      return fail(
        'newerVersion',
        [`File schema version ${migrated.version} is newer than this application supports`],
        migrated.version,
      );
    }
    return fail('unsupportedVersion', ['Unknown or unsupported schemaVersion'], migrated.version);
  }
  const parsed = ProjectDocumentSchema.safeParse(migrated.raw);
  if (!parsed.success) {
    return fail(
      'schema',
      parsed.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`),
    );
  }
  const integrity = checkIntegrity(parsed.data);
  if (integrity.length)
    return fail(
      'integrity',
      integrity.slice(0, 20).map((i) => i.message),
    );
  return { ok: true, doc: parsed.data, migrations: migrated.applied };
}
