import { executeCommands } from '@/domain/commands/engine';
import {
  createActivationCommands,
  createDiagramCommands,
  createFragmentCommands,
  createLifelineCommands,
  createMessageCommands,
  createNodeCommands,
  createNoteCommands,
  createRelationshipCommands,
  type RelationshipPreset,
} from '@/domain/commands/creators';
import type { Command } from '@/domain/commands/types';
import { sequentialIds, type IdGenerator } from '@/domain/ids';
import { createEmptyProject, makeAttribute, makeOperation, makeParameter } from '@/domain/model/factory';
import { parseAttributeText, parseOperationText } from '@/domain/notation/members';
import type { ID } from '@/domain/schemas/common';
import type { FragmentOperator, NodeElementKind } from '@/domain/schemas/elements';
import type { MessageSort } from '@/domain/schemas/members';
import type { DiagramKind, ProjectDocument } from '@/domain/schemas/project';
import { measureView } from '@/diagrams/render/measure';
import { defaultSizeFor } from '@/diagrams/registry/catalog';

/**
 * Fluent builder for templates and test fixtures. Every step goes through the command engine,
 * so templates are guaranteed to satisfy integrity and schema rules.
 */
export class ProjectBuilder {
  doc: ProjectDocument;
  readonly ids: IdGenerator;

  constructor(name: string, options: { modelName?: string; idPrefix?: string; description?: string } = {}) {
    this.ids = sequentialIds(options.idPrefix ?? 'tpl');
    this.doc = createEmptyProject({
      name,
      modelName: options.modelName ?? 'Model',
      description: options.description,
      ids: this.ids,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  private run(commands: Command[]): void {
    const outcome = executeCommands(this.doc, commands, { measure: measureView });
    if (!outcome.ok)
      throw new Error(`Template step failed: ${outcome.message} ${outcome.details.join('; ')}`);
    this.doc = outcome.doc;
  }

  get root(): ID {
    return this.doc.rootModelId;
  }

  diagram(kind: DiagramKind, name: string, ownerId: ID = this.root, behaviorName?: string): ID {
    const created = createDiagramCommands(this.doc, { kind, name, ownerId, behaviorName, ids: this.ids });
    if (!created.ok || !created.diagramId) throw new Error(`Cannot create ${kind} diagram`);
    this.run(created.commands);
    return created.diagramId;
  }

  node(
    diagramId: ID,
    kind: NodeElementKind,
    name: string,
    x: number,
    y: number,
    options: { subKind?: string; width?: number; height?: number; patch?: Record<string, unknown> } = {},
  ): { elementId: ID; viewId: ID } {
    const size = defaultSizeFor(kind, options.subKind);
    const created = createNodeCommands(this.doc, {
      diagramId,
      spec: { kind, subKind: options.subKind, baseName: name, name },
      position: { x, y },
      size: { width: options.width ?? size.width, height: options.height ?? size.height },
      ids: this.ids,
    });
    if (!created.ok || !created.elementId || !created.viewId)
      throw new Error(`Cannot create ${kind} ${name}`);
    const commands = [...created.commands];
    if (options.patch)
      commands.push({ type: 'element/update', elementId: created.elementId, patch: options.patch });
    this.run(commands);
    return { elementId: created.elementId, viewId: created.viewId };
  }

  attribute(elementId: ID, text: string): this {
    const parsed = parseAttributeText(text);
    if (!parsed) throw new Error(`Bad attribute "${text}"`);
    const member = makeAttribute({
      id: this.ids.next(),
      ...parsed,
      visibility: parsed.visibility ?? 'private',
    });
    this.run([{ type: 'member/add', elementId, collection: 'attributes', member }]);
    return this;
  }

  operation(elementId: ID, text: string, options: { isAbstract?: boolean } = {}): this {
    const parsed = parseOperationText(text);
    if (!parsed) throw new Error(`Bad operation "${text}"`);
    const member = makeOperation({
      id: this.ids.next(),
      name: parsed.name,
      visibility: parsed.visibility ?? 'public',
      isStatic: parsed.isStatic,
      isQuery: parsed.isQuery,
      isAbstract: options.isAbstract ?? false,
      returnType: parsed.returnType,
      parameters: parsed.parameters.map((p) => makeParameter({ id: this.ids.next(), ...p })),
    });
    this.run([{ type: 'member/add', elementId, collection: 'operations', member }]);
    return this;
  }

  literal(elementId: ID, name: string): this {
    this.run([
      { type: 'member/add', elementId, collection: 'literals', member: { id: this.ids.next(), name } },
    ]);
    return this;
  }

  member(
    elementId: ID,
    collection: 'extensionPoints' | 'slots' | 'tagDefinitions' | 'messages',
    member: Record<string, unknown>,
  ): ID {
    const id = this.ids.next();
    this.run([{ type: 'member/add', elementId, collection, member: { id, ...member } }]);
    return id;
  }

  update(elementId: ID, patch: Record<string, unknown>): this {
    this.run([{ type: 'element/update', elementId, patch }]);
    return this;
  }

  connect(
    diagramId: ID,
    preset: RelationshipPreset,
    sourceViewId: ID,
    targetViewId: ID,
    patch?: Record<string, unknown>,
  ): { relationshipId: ID; edgeViewId: ID } {
    const created = createRelationshipCommands(this.doc, {
      diagramId,
      preset,
      sourceViewId,
      targetViewId,
      ids: this.ids,
    });
    if (!created.ok) throw new Error(`Cannot connect ${preset}: ${created.reason}`);
    const commands = [...created.commands];
    if (patch) {
      const current = created.commands[0];
      const rel = current?.type === 'element/add' ? current.elements[0] : undefined;
      const merged: Record<string, unknown> = { ...patch };
      if (rel && 'sourceEnd' in rel && patch.sourceEnd)
        merged.sourceEnd = { ...rel.sourceEnd, ...(patch.sourceEnd as object) };
      if (rel && 'targetEnd' in rel && patch.targetEnd)
        merged.targetEnd = { ...rel.targetEnd, ...(patch.targetEnd as object) };
      commands.push({ type: 'element/update', elementId: created.relationshipId, patch: merged });
    }
    this.run(commands);
    return { relationshipId: created.relationshipId, edgeViewId: created.edgeViewId };
  }

  waypoints(
    diagramId: ID,
    edgeViewId: ID,
    points: Array<{ x: number; y: number }>,
    routing?: 'straight' | 'orthogonal',
  ): this {
    this.run([
      {
        type: 'view/update',
        diagramId,
        viewId: edgeViewId,
        patch: { waypoints: points, ...(routing ? { routing } : {}) },
      },
    ]);
    return this;
  }

  viewPatch(diagramId: ID, viewId: ID, patch: Record<string, unknown>): this {
    this.run([{ type: 'view/update', diagramId, viewId, patch }]);
    return this;
  }

  note(diagramId: ID, text: string, x: number, y: number, width = 180, height = 60): ID {
    const created = createNoteCommands(diagramId, { x, y }, { width, height }, text, this.ids);
    if (!created.ok) throw new Error('note');
    this.run(created.commands);
    return created.createdViewIds[0]!;
  }

  lifeline(diagramId: ID, name: string, x: number, options: { actor?: boolean; typeName?: string } = {}): ID {
    const created = createLifelineCommands(this.doc, {
      diagramId,
      x,
      baseName: name,
      name,
      headStyle: options.actor ? 'actor' : 'object',
      ids: this.ids,
    });
    if (!created.ok || !created.viewId || !created.elementId) throw new Error('lifeline');
    const commands = [...created.commands];
    if (options.typeName)
      commands.push({
        type: 'element/update',
        elementId: created.elementId,
        patch: { typeName: options.typeName },
      });
    this.run(commands);
    return created.viewId;
  }

  message(
    diagramId: ID,
    from: ID | null,
    to: ID | null,
    sort: MessageSort,
    y: number,
    name: string,
    args = '',
  ): ID {
    const created = createMessageCommands(this.doc, {
      diagramId,
      sourceViewId: from,
      targetViewId: to,
      sort,
      y,
      name,
      ids: this.ids,
    });
    if (!created.ok || !created.elementId)
      throw new Error(`message ${name}: ${created.ok ? '' : created.reason}`);
    const commands = [...created.commands];
    if (args)
      commands.push({ type: 'element/update', elementId: created.elementId, patch: { arguments: args } });
    this.run(commands);
    return created.viewId!;
  }

  activation(diagramId: ID, lifelineViewId: ID, startY: number, endY: number): this {
    const created = createActivationCommands(this.doc, {
      diagramId,
      lifelineViewId,
      startY,
      endY,
      ids: this.ids,
    });
    if (!created.ok) throw new Error('activation');
    this.run(created.commands);
    return this;
  }

  fragment(
    diagramId: ID,
    operator: FragmentOperator,
    bounds: { x: number; y: number; width: number; height: number },
    guards: string[],
    dividers: number[] = [],
  ): ID {
    const created = createFragmentCommands(this.doc, { diagramId, operator, bounds, ids: this.ids });
    if (!created.ok) throw new Error('fragment');
    this.run(created.commands);
    const viewId = created.createdViewIds[0]!;
    const view = this.doc.diagrams[diagramId]!.views[viewId];
    if (view?.kind !== 'fragment') throw new Error('fragment view');
    const el = this.doc.modelElements[view.elementId];
    if (el?.kind !== 'combinedFragment') throw new Error('fragment element');
    const commands: Command[] = [];
    // Add operands beyond those created by default.
    for (let i = el.operands.length; i < guards.length; i += 1) {
      commands.push({
        type: 'member/add',
        elementId: el.id,
        collection: 'operands',
        member: { id: this.ids.next(), guard: '' },
      });
    }
    if (commands.length) this.run(commands);
    const fresh = this.doc.modelElements[el.id];
    if (fresh?.kind !== 'combinedFragment') throw new Error('fragment element');
    const updates: Command[] = fresh.operands.map((operand, i) => ({
      type: 'member/update',
      elementId: fresh.id,
      collection: 'operands',
      memberId: operand.id,
      patch: { guard: guards[i] ?? '' },
    }));
    if (dividers.length) {
      const operandYs = Object.fromEntries(
        fresh.operands
          .slice(1)
          .map((o, i) => [o.id, dividers[i] ?? bounds.y + ((i + 1) * bounds.height) / fresh.operands.length]),
      );
      updates.push({ type: 'view/update', diagramId, viewId, patch: { operandYs } });
    }
    this.run(updates);
    return viewId;
  }

  build(): ProjectDocument {
    return this.doc;
  }
}
