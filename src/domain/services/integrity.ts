import type { ID } from '../schemas/common';
import { isRelationship, type ModelElement } from '../schemas/elements';
import type { ProjectDocument, UMLDiagram } from '../schemas/project';
import type { DiagramView } from '../schemas/views';
import { canOwn, DIAGRAM_KIND_INFO } from '../model/metadata';
import { collectMemberIds, collectReferences } from '../model/references';

/**
 * Structural invariants of a project document. Any violation means the document is corrupt:
 * commands that would produce one are rejected and files that contain one are refused.
 * (Modeling-quality problems are reported by the validation engine instead.)
 */
export interface IntegrityIssue {
  code:
    | 'root-missing'
    | 'record-key-mismatch'
    | 'duplicate-id'
    | 'owner-missing'
    | 'owner-not-allowed'
    | 'owner-cycle'
    | 'multiple-roots'
    | 'dangling-reference'
    | 'reference-kind'
    | 'diagram-owner'
    | 'view-element-missing'
    | 'view-kind-not-allowed'
    | 'edge-endpoint'
    | 'container-invalid'
    | 'timeline-reference'
    | 'member-reference';
  message: string;
  ids: ID[];
}

const MAX_ISSUES = 200;

export function checkIntegrity(doc: ProjectDocument): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const report = (code: IntegrityIssue['code'], message: string, ...ids: ID[]) => {
    if (issues.length < MAX_ISSUES) issues.push({ code, message, ids });
  };

  const seen = new Map<ID, string>();
  const claim = (id: ID, what: string) => {
    const previous = seen.get(id);
    if (previous) report('duplicate-id', `Duplicate identifier "${id}" (${previous} and ${what})`, id);
    else seen.set(id, what);
  };

  claim(doc.id, 'project');
  const elements = doc.modelElements;
  const memberIds = new Set<ID>();

  // ---- Elements -------------------------------------------------------------------------------
  const root = elements[doc.rootModelId];
  if (!root || root.kind !== 'model' || root.ownerId !== null) {
    report('root-missing', 'The root model element is missing or invalid', doc.rootModelId);
  }

  for (const [key, el] of Object.entries(elements)) {
    if (key !== el.id)
      report('record-key-mismatch', `Element record key "${key}" does not match its id "${el.id}"`, key);
    claim(el.id, `element ${el.kind}`);
    for (const memberId of collectMemberIds(el)) {
      claim(memberId, `member of ${el.id}`);
      memberIds.add(memberId);
    }
    if (el.ownerId === null) {
      if (el.id !== doc.rootModelId) report('multiple-roots', `Element "${el.name}" has no owner`, el.id);
      continue;
    }
    const owner = elements[el.ownerId];
    if (!owner) {
      report('owner-missing', `Owner of "${el.name}" does not exist`, el.id, el.ownerId);
    } else if (!canOwn(owner.kind, el.kind)) {
      report('owner-not-allowed', `A ${owner.kind} cannot own a ${el.kind}`, el.id, owner.id);
    }
  }

  // Owner cycles: walk each chain once with memoisation.
  const resolved = new Set<ID>();
  for (const el of Object.values(elements)) {
    const path: ID[] = [];
    const onPath = new Set<ID>();
    let current: ModelElement | undefined = el;
    while (current && !resolved.has(current.id)) {
      if (onPath.has(current.id)) {
        report('owner-cycle', `Ownership cycle involving "${current.name}"`, current.id);
        break;
      }
      onPath.add(current.id);
      path.push(current.id);
      current = current.ownerId ? elements[current.ownerId] : undefined;
    }
    for (const id of path) resolved.add(id);
  }

  for (const el of Object.values(elements)) {
    for (const ref of collectReferences(el)) {
      const target = elements[ref.targetId];
      if (!target) {
        report(
          'dangling-reference',
          `"${el.name || el.kind}" references a missing element (${ref.field})`,
          el.id,
          ref.targetId,
        );
      } else if (ref.targetKinds && !ref.targetKinds.includes(target.kind)) {
        report(
          'reference-kind',
          `"${el.name || el.kind}".${ref.field} must reference ${ref.targetKinds.join('/')}`,
          el.id,
          target.id,
        );
      }
    }
  }

  // Member-level references (validated after all member IDs are known).
  for (const el of Object.values(elements)) {
    if (el.kind === 'instanceSpecification') {
      for (const slot of el.slots) {
        if (slot.definingFeatureId && !memberIds.has(slot.definingFeatureId)) {
          report(
            'member-reference',
            `Slot "${slot.name}" references a missing attribute`,
            el.id,
            slot.definingFeatureId,
          );
        }
      }
    }
    if (el.kind === 'extend') {
      const base = elements[el.targetId];
      const points = new Set(base?.kind === 'useCase' ? base.extensionPoints.map((p) => p.id) : []);
      for (const id of el.extensionPointIds) {
        if (!points.has(id))
          report(
            'member-reference',
            'Extend references an extension point not owned by its base use case',
            el.id,
            id,
          );
      }
    }
  }

  // ---- Diagrams ------------------------------------------------------------------------------
  for (const [key, diagram] of Object.entries(doc.diagrams)) {
    if (key !== diagram.id)
      report('record-key-mismatch', `Diagram record key "${key}" does not match its id`, key);
    claim(diagram.id, 'diagram');
    const info = DIAGRAM_KIND_INFO[diagram.kind];
    const owner = elements[diagram.ownerId];
    if (!owner || !info.ownerKinds.includes(owner.kind)) {
      report('diagram-owner', `Diagram "${diagram.name}" has an invalid owner`, diagram.id, diagram.ownerId);
    }
    checkDiagramViews(doc, diagram, report, claim);
  }

  return issues;
}

type Reporter = (code: IntegrityIssue['code'], message: string, ...ids: ID[]) => void;

function checkDiagramViews(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  report: Reporter,
  claim: (id: ID, what: string) => void,
): void {
  const info = DIAGRAM_KIND_INFO[diagram.kind];
  const views = diagram.views;
  const elements = doc.modelElements;
  const graphKinds = new Set<DiagramView['kind']>(['node', 'edge', 'note', 'noteLink']);
  const timelineKinds = new Set<DiagramView['kind']>([
    'lifeline',
    'message',
    'activation',
    'fragment',
    'note',
  ]);
  const allowedViewKinds =
    info.renderMode === 'sequence' ? timelineKinds : info.renderMode === 'graph' ? graphKinds : new Set();

  for (const [key, view] of Object.entries(views)) {
    if (key !== view.id) report('record-key-mismatch', `View record key "${key}" does not match its id`, key);
    claim(view.id, `view in ${diagram.id}`);
    if (!allowedViewKinds.has(view.kind)) {
      report(
        'view-kind-not-allowed',
        `A ${view.kind} view is not allowed in a ${diagram.kind} diagram`,
        view.id,
      );
      continue;
    }
    if ('elementId' in view) {
      const el = elements[view.elementId];
      if (!el) {
        report(
          'view-element-missing',
          `View "${view.id}" references a missing element`,
          view.id,
          view.elementId,
        );
        continue;
      }
      const expected: Partial<Record<DiagramView['kind'], (k: string) => boolean>> = {
        node: (k) => !isRelationship(el) && (info.nodeKinds as readonly string[]).includes(k),
        edge: () => isRelationship(el) && info.relationshipKinds.includes(el.kind as never),
        lifeline: (k) => k === 'lifeline',
        message: (k) => k === 'message',
        activation: (k) => k === 'activation',
        fragment: (k) => k === 'combinedFragment',
      };
      if (!expected[view.kind]?.(el.kind)) {
        report(
          'view-kind-not-allowed',
          `A ${el.kind} cannot be shown as a ${view.kind} view in a ${diagram.kind} diagram`,
          view.id,
          el.id,
        );
        continue;
      }
    }

    switch (view.kind) {
      case 'node':
      case 'note':
        if (view.containerViewId) {
          const container = views[view.containerViewId];
          if (!container || container.kind !== 'node' || container.id === view.id) {
            report('container-invalid', `View "${view.id}" has an invalid container`, view.id);
          }
        }
        break;
      case 'edge': {
        const rel = elements[view.elementId];
        const source = views[view.sourceViewId];
        const target = views[view.targetViewId];
        if (
          !rel ||
          !isRelationship(rel) ||
          !source ||
          !target ||
          source.kind !== 'node' ||
          target.kind !== 'node'
        ) {
          report(
            'edge-endpoint',
            `Edge "${view.id}" is not connected to node views of this diagram`,
            view.id,
          );
        } else if (source.elementId !== rel.sourceId || target.elementId !== rel.targetId) {
          report(
            'edge-endpoint',
            `Edge "${view.id}" endpoints do not match its relationship`,
            view.id,
            rel.id,
          );
        }
        break;
      }
      case 'noteLink': {
        const source = views[view.sourceViewId];
        const target = views[view.targetViewId];
        if (!source || source.kind !== 'note' || !target || target.id === source.id) {
          report('edge-endpoint', `Note link "${view.id}" is not attached to a note and a view`, view.id);
        }
        break;
      }
      case 'message': {
        const msg = elements[view.elementId];
        if (msg?.kind !== 'message') break;
        const check = (viewId: ID | null, lifelineId: ID | null, end: string) => {
          if ((viewId === null) !== (lifelineId === null)) {
            report('timeline-reference', `Message "${msg.name}" ${end} view and lifeline disagree`, view.id);
            return;
          }
          if (viewId === null) return;
          const lv = views[viewId];
          if (!lv || lv.kind !== 'lifeline' || lv.elementId !== lifelineId) {
            report(
              'timeline-reference',
              `Message "${msg.name}" ${end} does not reference the lifeline view of its lifeline`,
              view.id,
            );
          }
        };
        check(view.sourceViewId, msg.sourceLifelineId, 'sender');
        check(view.targetViewId, msg.targetLifelineId, 'receiver');
        break;
      }
      case 'activation': {
        const act = elements[view.elementId];
        const lv = views[view.lifelineViewId];
        if (act?.kind !== 'activation' || !lv || lv.kind !== 'lifeline' || lv.elementId !== act.lifelineId) {
          report('timeline-reference', `Activation "${view.id}" is not placed on its lifeline`, view.id);
        }
        break;
      }
      case 'fragment': {
        const frag = elements[view.elementId];
        if (frag?.kind !== 'combinedFragment') break;
        const operandIds = new Set(frag.operands.map((o) => o.id));
        for (const operandId of Object.keys(view.operandYs)) {
          if (!operandIds.has(operandId))
            report('timeline-reference', `Fragment view references a missing operand`, view.id, operandId);
        }
        break;
      }
      default:
        break;
    }
  }

  // Visual containment cycles.
  for (const view of Object.values(views)) {
    if (view.kind !== 'node' && view.kind !== 'note') continue;
    const seenChain = new Set<ID>([view.id]);
    let current: DiagramView | undefined = view.containerViewId ? views[view.containerViewId] : undefined;
    while (current && (current.kind === 'node' || current.kind === 'note')) {
      if (seenChain.has(current.id)) {
        report('container-invalid', `Visual containment cycle involving view "${view.id}"`, view.id);
        break;
      }
      seenChain.add(current.id);
      current = current.containerViewId ? views[current.containerViewId] : undefined;
    }
  }
}
