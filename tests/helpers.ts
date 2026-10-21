import { executeCommands } from '@/domain/commands/engine';
import {
  createDiagramCommands,
  createNodeCommands,
  createRelationshipCommands,
  type NodeSpec,
  type RelationshipPreset,
} from '@/domain/commands/creators';
import type { Command } from '@/domain/commands/types';
import { sequentialIds, type IdGenerator } from '@/domain/ids';
import { createEmptyProject } from '@/domain/model/factory';
import type { ID } from '@/domain/schemas/common';
import type { DiagramKind, ProjectDocument } from '@/domain/schemas/project';

export function newProject(ids: IdGenerator = sequentialIds('t')): ProjectDocument {
  return createEmptyProject({ name: 'Test', ids, now: new Date('2026-01-01T00:00:00.000Z') });
}

/** Apply commands or throw with the engine's diagnostics (keeps tests terse). */
export function apply(doc: ProjectDocument, commands: Command | Command[]): ProjectDocument {
  const outcome = executeCommands(doc, Array.isArray(commands) ? commands : [commands]);
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}\n${outcome.details.join('\n')}`);
  return outcome.doc;
}

export interface Fixture {
  doc: ProjectDocument;
  ids: IdGenerator;
}

export function withDiagram(kind: DiagramKind, name = 'D', fixture?: Fixture): Fixture & { diagramId: ID } {
  const ids = fixture?.ids ?? sequentialIds('t');
  const doc = fixture?.doc ?? newProject(ids);
  const created = createDiagramCommands(doc, { kind, name, ownerId: doc.rootModelId, ids });
  if (!created.ok || !created.diagramId)
    throw new Error(`cannot create diagram: ${created.ok ? '' : created.reason}`);
  return { doc: apply(doc, created.commands), ids, diagramId: created.diagramId };
}

export function addNode(
  f: Fixture,
  diagramId: ID,
  spec: Omit<NodeSpec, 'baseName'> & { baseName?: string },
  x = 0,
  y = 0,
  size = { width: 120, height: 60 },
): { doc: ProjectDocument; elementId: ID; viewId: ID } {
  const created = createNodeCommands(f.doc, {
    diagramId,
    spec: { baseName: spec.baseName ?? spec.kind, ...spec },
    position: { x, y },
    size,
    ids: f.ids,
  });
  if (!created.ok || !created.elementId || !created.viewId)
    throw new Error(`cannot create node: ${created.ok ? '' : created.reason}`);
  f.doc = apply(f.doc, created.commands);
  return { doc: f.doc, elementId: created.elementId, viewId: created.viewId };
}

export function connect(
  f: Fixture,
  diagramId: ID,
  preset: RelationshipPreset,
  sourceViewId: ID,
  targetViewId: ID,
): { relationshipId: ID; edgeViewId: ID } {
  const created = createRelationshipCommands(f.doc, {
    diagramId,
    preset,
    sourceViewId,
    targetViewId,
    ids: f.ids,
  });
  if (!created.ok) throw new Error(`cannot connect: ${created.reason}`);
  f.doc = apply(f.doc, created.commands);
  return { relationshipId: created.relationshipId, edgeViewId: created.edgeViewId };
}
