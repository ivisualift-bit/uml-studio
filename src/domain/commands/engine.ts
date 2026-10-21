import { enablePatches, produceWithPatches, type Patch } from 'immer';
import type * as z from 'zod';
import type { ID } from '../schemas/common';
import { ModelElementSchema } from '../schemas/elements';
import { DiagramSchema, ProjectDocumentSchema, type ProjectDocument } from '../schemas/project';
import { DiagramViewSchema } from '../schemas/views';
import { checkIntegrity } from '../services/integrity';
import { deepEqual } from '../util';
import { applyCommand } from './handlers';
import { Transaction } from './transaction';
import { CommandError, type Command, type CommandErrorCode, type ViewMeasurer } from './types';

enablePatches();

export interface CommandSuccess {
  ok: true;
  doc: ProjectDocument;
  patches: Patch[];
  inversePatches: Patch[];
  affectedElementIds: ID[];
  affectedDiagramIds: ID[];
}

export interface CommandFailure {
  ok: false;
  code: CommandErrorCode;
  message: string;
  details: string[];
}

export type CommandOutcome = CommandSuccess | CommandFailure;

export interface ExecuteOptions {
  measure?: ViewMeasurer;
}

const DiagramHeaderSchema = DiagramSchema.omit({ views: true });
const ProjectHeaderSchema = ProjectDocumentSchema.pick({ name: true, description: true, settings: true });

/** Validate an object against a schema AND require it to already be in canonical form. */
function canonicalProblems(schema: z.ZodType, value: unknown, label: string): string[] {
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.issues
      .slice(0, 5)
      .map((i) => `${label}.${i.path.map(String).join('.')}: ${i.message}`);
  }
  return deepEqual(result.data, value) ? [] : [`${label}: not in canonical form (missing or unknown fields)`];
}

function validateTouched(doc: ProjectDocument, tx: Transaction): string[] {
  const problems: string[] = [];
  for (const id of tx.elementIds) {
    const el = doc.modelElements[id];
    if (el) problems.push(...canonicalProblems(ModelElementSchema, el, `element ${id}`));
  }
  for (const id of tx.diagramIds) {
    const diagram = doc.diagrams[id];
    if (!diagram) continue;
    const { views: _views, ...header } = diagram;
    problems.push(...canonicalProblems(DiagramHeaderSchema, header, `diagram ${id}`));
  }
  for (const key of tx.viewKeys) {
    const [diagramId, viewId] = key.split('/') as [ID, ID];
    const view = doc.diagrams[diagramId]?.views[viewId];
    if (view) problems.push(...canonicalProblems(DiagramViewSchema, view, `view ${viewId}`));
  }
  if (tx.projectTouched) {
    problems.push(
      ...canonicalProblems(
        ProjectHeaderSchema,
        { name: doc.name, description: doc.description, settings: doc.settings },
        'project',
      ),
    );
  }
  return problems;
}

/**
 * Execute commands as ONE atomic transaction. Either every command applies and the resulting
 * document passes integrity + schema checks, or nothing changes and a structured failure is returned.
 */
export function executeCommands(
  doc: ProjectDocument,
  commands: readonly Command[],
  options: ExecuteOptions = {},
): CommandOutcome {
  const tx = new Transaction(options.measure);
  let next: ProjectDocument;
  let patches: Patch[];
  let inversePatches: Patch[];
  try {
    [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
      for (const command of commands) applyCommand(draft, command, tx);
    });
  } catch (error) {
    if (error instanceof CommandError) {
      return { ok: false, code: error.code, message: error.message, details: error.details };
    }
    return {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: [],
    };
  }
  if (patches.length === 0) {
    return { ok: true, doc, patches, inversePatches, affectedElementIds: [], affectedDiagramIds: [] };
  }
  const schemaProblems = validateTouched(next, tx);
  if (schemaProblems.length) {
    return {
      ok: false,
      code: 'schema',
      message: 'The change would produce invalid data',
      details: schemaProblems,
    };
  }
  const integrity = checkIntegrity(next);
  if (integrity.length) {
    return {
      ok: false,
      code: 'integrity',
      message: 'The change would break model integrity',
      details: integrity.slice(0, 10).map((i) => i.message),
    };
  }
  return {
    ok: true,
    doc: next,
    patches,
    inversePatches,
    affectedElementIds: [...tx.elementIds],
    affectedDiagramIds: [...tx.diagramIds],
  };
}
