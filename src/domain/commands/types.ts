import type { ID } from '../schemas/common';
import type { ModelElement } from '../schemas/elements';
import type { DiagramOptions, ProjectSettings, UMLDiagram, Viewport } from '../schemas/project';
import type { DiagramView } from '../schemas/views';

/** Owned-member collections editable through member commands. */
export type MemberCollection =
  | 'attributes'
  | 'operations'
  | 'parameters'
  | 'literals'
  | 'extensionPoints'
  | 'operands'
  | 'slots'
  | 'tagDefinitions'
  | 'messages'
  | 'appliedStereotypes';

export type FieldPatch = Record<string, unknown>;

export type Command =
  // ---- project
  | { type: 'project/rename'; name: string }
  | { type: 'project/update'; description?: string; settings?: Partial<ProjectSettings> }
  // ---- diagrams
  | { type: 'diagram/add'; diagram: UMLDiagram; elements?: ModelElement[] }
  | { type: 'diagram/rename'; diagramId: ID; name: string }
  | { type: 'diagram/update'; diagramId: ID; documentation?: string; options?: Partial<DiagramOptions> }
  | { type: 'diagram/delete'; diagramId: ID }
  | { type: 'diagram/setViewport'; diagramId: ID; viewport: Viewport }
  // ---- semantic elements
  | { type: 'element/add'; elements: ModelElement[]; diagramId?: ID; views?: DiagramView[] }
  | { type: 'element/update'; elementId: ID; patch: FieldPatch }
  | { type: 'element/move'; elementId: ID; newOwnerId: ID }
  | { type: 'element/delete'; elementIds: ID[] }
  | {
      type: 'element/reconnect';
      relationshipId: ID;
      end: 'source' | 'target';
      newElementId: ID;
      /** Edge views to re-attach (same command keeps semantic + views consistent). */
      edgeUpdates: Array<{ diagramId: ID; edgeViewId: ID; nodeViewId: ID }>;
    }
  // ---- owned members (attributes, operations, parameters, literals, operands…)
  | {
      type: 'member/add';
      elementId: ID;
      collection: MemberCollection;
      member: Record<string, unknown> & { id: ID };
      index?: number;
      operationId?: ID;
    }
  | {
      type: 'member/update';
      elementId: ID;
      collection: MemberCollection;
      memberId: ID;
      patch: FieldPatch;
      operationId?: ID;
    }
  | { type: 'member/delete'; elementId: ID; collection: MemberCollection; memberId: ID; operationId?: ID }
  | {
      type: 'member/move';
      elementId: ID;
      collection: MemberCollection;
      memberId: ID;
      toIndex: number;
      operationId?: ID;
    }
  // ---- views
  | { type: 'view/add'; diagramId: ID; views: DiagramView[] }
  | {
      type: 'view/remove';
      diagramId: ID;
      viewIds: ID[];
      /** Delete diagram-scoped semantics (relationships, messages…) whose last view is removed. */
      deleteScopedOrphans: boolean;
    }
  | { type: 'view/move'; diagramId: ID; viewIds: ID[]; dx: number; dy: number }
  | { type: 'view/update'; diagramId: ID; viewId: ID; patch: FieldPatch; recomputeContainment?: boolean }
  | { type: 'view/updateMany'; diagramId: ID; patches: Record<ID, FieldPatch> }
  | { type: 'view/reorder'; diagramId: ID; viewIds: ID[]; position: 'front' | 'back' };

export type CommandType = Command['type'];

/** Stable machine-readable error codes; the UI maps each to a localized message. */
export type CommandErrorCode =
  | 'notFound'
  | 'invalidPayload'
  | 'immutableField'
  | 'ownershipNotAllowed'
  | 'ownershipCycle'
  | 'endpointNotAllowed'
  | 'viewNotAllowed'
  | 'duplicateId'
  | 'integrity'
  | 'schema'
  | 'rootProtected'
  | 'internal';

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly details: string[];

  constructor(code: CommandErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.details = details;
  }
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Injected by the application so domain geometry can use rendered (intrinsic) sizes. */
export type ViewMeasurer = (diagram: UMLDiagram, view: DiagramView) => Bounds | null;
