import type { IdGenerator } from '@/domain/ids';
import {
  CLASSIFIER_KINDS,
  DIAGRAM_KIND_INFO,
  PACKAGE_LIKE,
  canOwn,
  checkRelationshipEndpoints,
} from '@/domain/model/metadata';
import {
  createEmptyProject,
  makeAttribute,
  makeDiagram,
  makeElement,
  makeExtensionPoint,
  makeLiteral,
  makeOperation,
  makeParameter,
  makeView,
} from '@/domain/model/factory';
import type { ID } from '@/domain/schemas/common';
import type { ElementKind, ModelElement, RelationEnd, RelationshipKind } from '@/domain/schemas/elements';
import type { Attribute, Operation, Parameter } from '@/domain/schemas/members';
import { ProjectDocumentSchema, type DiagramKind, type ProjectDocument } from '@/domain/schemas/project';
import type { Compartment, DiagramView, ViewStyle } from '@/domain/schemas/views';
import { scanJson } from '@/domain/serialization/jsonScan';
import { MAX_PROJECT_BYTES } from '@/domain/serialization/projectFile';
import { findContainerFor } from '@/domain/services/containment';
import { checkIntegrity } from '@/domain/services/integrity';
import { isPlainObject } from '@/domain/util';

/**
 * EXPERIMENTAL best-effort importer for the class / use case / package subset of StarUML `.mdj`
 * project files (spec §5.4). The input is untrusted: it is scanned, parsed into loose adapter
 * records, translated into freshly identified native elements and views, and the result must pass
 * the same Zod schema + integrity checks as a `.umls` file. Everything that is not translated is
 * counted in the report. Tested only against hand-written fixtures — not against files produced by
 * StarUML itself — so no compatibility is claimed.
 */

type Raw = Record<string, unknown>;

export type MdjImportErrorCode =
  'tooLarge' | 'empty' | 'tooDeep' | 'duplicateKeys' | 'invalidJson' | 'notMdj' | 'invalid';

export interface MdjImportReport {
  projectName: string;
  /** Native model elements created (the root model excluded). */
  elements: number;
  diagrams: number;
  views: number;
  /** Attributes, operations, parameters, literals and extension points. */
  members: number;
  /** Translated source records per StarUML `_type`. */
  imported: Record<string, number>;
  /** Source records that were skipped per StarUML `_type` (element subtrees and views). */
  unsupported: Record<string, number>;
  warnings: string[];
  /** Warnings beyond the reported ones. */
  moreWarnings: number;
}

export type MdjImportResult =
  | { ok: true; doc: ProjectDocument; report: MdjImportReport }
  | { ok: false; error: { code: MdjImportErrorCode; details: string[] } };

export interface MdjImportOptions {
  ids: IdGenerator;
  now: Date;
  /** Used as the project name when the file has none. */
  fileName?: string;
  maxBytes?: number;
}

const MAX_WARNINGS = 200;
const MAX_RECORDS = 200_000;

const ELEMENT_TYPES: Record<string, ElementKind> = {
  UMLModel: 'package',
  UMLPackage: 'package',
  UMLClass: 'class',
  UMLInterface: 'interface',
  UMLEnumeration: 'enumeration',
  UMLDataType: 'dataType',
  UMLPrimitiveType: 'primitiveType',
  UMLSignal: 'signal',
  UMLActor: 'actor',
  UMLUseCase: 'useCase',
  UMLUseCaseSubject: 'subject',
};

const RELATIONSHIP_TYPES: Record<string, { kind: RelationshipKind; stereotype?: string }> = {
  UMLAssociation: { kind: 'association' },
  UMLGeneralization: { kind: 'generalization' },
  UMLInterfaceRealization: { kind: 'realization' },
  UMLRealization: { kind: 'realization' },
  UMLDependency: { kind: 'dependency' },
  UMLAbstraction: { kind: 'dependency', stereotype: 'abstraction' },
  UMLUsage: { kind: 'dependency', stereotype: 'use' },
  UMLInclude: { kind: 'include' },
  UMLExtend: { kind: 'extend' },
};

const DIAGRAM_TYPES: Record<string, DiagramKind> = {
  UMLClassDiagram: 'class',
  UMLUseCaseDiagram: 'useCase',
  UMLPackageDiagram: 'package',
};

/** Element kinds an attribute/parameter type reference may point to (subset of the native rule). */
const TYPE_TARGETS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  ...CLASSIFIER_KINDS,
  'actor',
  'useCase',
]);

const DEFAULT_COLORS = { fill: '#ffffff', stroke: '#000000', textColor: '#000000' } as const;

// -------------------------------------------------------------------------------------------------
// Loose readers for untrusted values
// -------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function text(value: unknown, max = 1000): string {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS, '').slice(0, max) : '';
}

/** Single-line text (names, types, multiplicities). */
function line(value: unknown, max = 1000): string {
  return text(value, max).replace(/[\r\n\t]+/g, ' ');
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function refOf(value: unknown): string | null {
  return isPlainObject(value) && typeof value.$ref === 'string' ? value.$ref : null;
}

function records(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

/** Own-property lookup: `_type` values such as "toString" must not hit Object.prototype. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Source `_type`, restricted to identifier characters so it is safe as a report key and label. */
function typeOf(raw: Raw): string {
  if (typeof raw._type !== 'string') return '(untyped)';
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(raw._type) ? raw._type : '(invalid type)';
}

function visibility(value: unknown): 'public' | 'private' | 'protected' | 'package' {
  return value === 'private' || value === 'protected' || value === 'package' ? value : 'public';
}

const clampCoord = (v: number) => Math.min(1_000_000, Math.max(-1_000_000, v));
const clampSize = (v: number, min: number) => Math.min(100_000, Math.max(min, v));

function color(value: unknown, fallback: string): string | undefined {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return value.toLowerCase() === fallback ? undefined : value.toLowerCase();
}

/** StarUML stores edge geometry as "x1:y1;x2:y2;…" (endpoints included). */
function parsePoints(value: unknown): Array<{ x: number; y: number }> {
  if (typeof value !== 'string') return [];
  const points: Array<{ x: number; y: number }> = [];
  for (const pair of value.split(';').slice(0, 202)) {
    const [xs, ys] = pair.split(':');
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x: clampCoord(x), y: clampCoord(y) });
  }
  return points;
}

// -------------------------------------------------------------------------------------------------
// Translation
// -------------------------------------------------------------------------------------------------

interface ElementEntry {
  raw: Raw;
  id: ID;
  kind: ElementKind;
  ownerId: ID;
}

class Translation {
  readonly report: MdjImportReport;
  /** Every source record with an `_id`, for name lookups of referenced records. */
  readonly byId = new Map<string, Raw>();
  /** Source element id → native element id. */
  readonly idMap = new Map<string, ID>();
  readonly kinds = new Map<ID, ElementKind>();
  readonly parents = new Map<ID, ID | null>();
  /** Source extension point id → native member id + owning use case. */
  readonly extensionPoints = new Map<string, { id: ID; useCaseId: ID }>();
  readonly entries: ElementEntry[] = [];
  readonly relationships: Raw[] = [];
  readonly diagrams: Array<{ raw: Raw; contextId: ID }> = [];
  readonly elements: Record<ID, ModelElement> = {};
  private readonly seen = new Set<Raw>();

  constructor(
    readonly ids: IdGenerator,
    readonly rootId: ID,
    projectName: string,
  ) {
    this.report = {
      projectName,
      elements: 0,
      diagrams: 0,
      views: 0,
      members: 0,
      imported: {},
      unsupported: {},
      warnings: [],
      moreWarnings: 0,
    };
    this.kinds.set(rootId, 'model');
    this.parents.set(rootId, null);
  }

  warn(message: string): void {
    if (this.report.warnings.length < MAX_WARNINGS) this.report.warnings.push(message);
    else this.report.moreWarnings += 1;
  }

  countImported(type: string): void {
    this.report.imported[type] = (lookup(this.report.imported, type) ?? 0) + 1;
  }

  countUnsupported(type: string): void {
    this.report.unsupported[type] = (lookup(this.report.unsupported, type) ?? 0) + 1;
  }

  /** Skipped element: count it and everything it owns (elements and diagrams, not views). */
  skipSubtree(raw: Raw): void {
    const stack = [raw];
    while (stack.length) {
      const current = stack.pop()!;
      this.countUnsupported(typeOf(current));
      stack.push(...records(current.ownedElements));
    }
  }

  label(raw: Raw): string {
    const name = line(raw.name, 80);
    return name ? `${typeOf(raw)} "${name}"` : typeOf(raw);
  }

  /** Nearest native ancestor (starting at `contextId`) allowed to own `kind`; the root otherwise. */
  ownerFor(kind: ElementKind, contextId: ID): ID {
    let current: ID | null | undefined = contextId;
    while (current) {
      const ownerKind = this.kinds.get(current);
      if (ownerKind && canOwn(ownerKind, kind)) return current;
      current = this.parents.get(current);
    }
    return this.rootId;
  }

  nearestPackage(contextId: ID): ID {
    let current: ID | null | undefined = contextId;
    while (current) {
      const kind = this.kinds.get(current);
      if (kind && PACKAGE_LIKE.includes(kind)) return current;
      current = this.parents.get(current);
    }
    return this.rootId;
  }

  stereotypeOf(value: unknown): string {
    if (typeof value === 'string') return line(value, 200);
    const target = refOf(value);
    return target ? line(this.byId.get(target)?.name, 200) : '';
  }

  /** Attribute/parameter type: plain text, or a reference to a classifier. */
  typeRef(value: unknown): { type: string; typeElementId: ID | null } {
    if (typeof value === 'string') return { type: line(value), typeElementId: null };
    const target = refOf(value);
    if (!target) return { type: '', typeElementId: null };
    const name = line(this.byId.get(target)?.name);
    const native = this.idMap.get(target);
    const kind = native ? this.kinds.get(native) : undefined;
    return { type: name, typeElementId: native && kind && TYPE_TARGETS.has(kind) ? native : null };
  }

  // ---- Pass 1: identify supported elements and their owners ----------------------------------

  walk(children: unknown, contextId: ID): void {
    for (const raw of records(children)) {
      const type = typeOf(raw);
      if (typeof raw._id !== 'string') {
        this.countUnsupported(type);
        this.warn(`${this.label(raw)} has no _id and was skipped`);
        continue;
      }
      if (this.idMap.has(raw._id) || this.seen.has(raw)) {
        this.skipSubtree(raw);
        this.warn(`${this.label(raw)} repeats an _id that was already imported and was skipped`);
        continue;
      }
      this.seen.add(raw);
      if (lookup(DIAGRAM_TYPES, type)) {
        this.diagrams.push({ raw, contextId });
        continue;
      }
      if (lookup(RELATIONSHIP_TYPES, type)) {
        this.relationships.push(raw);
        continue;
      }
      const kind = lookup(ELEMENT_TYPES, type);
      if (!kind) {
        this.skipSubtree(raw);
        continue;
      }
      const id = this.ids.next();
      const ownerId = this.ownerFor(kind, contextId);
      if (ownerId !== contextId)
        this.warn(
          `${this.label(raw)} cannot be owned by its parent here; it was moved to the nearest package`,
        );
      this.idMap.set(raw._id, id);
      this.kinds.set(id, kind);
      this.parents.set(id, ownerId);
      this.entries.push({ raw, id, kind, ownerId });
      this.walk(raw.ownedElements, id);
    }
  }

  // ---- Pass 2: elements with their members ---------------------------------------------------

  attributes(raw: Raw): Attribute[] {
    return records(raw.attributes).map((a) => {
      this.report.members += 1;
      return makeAttribute({
        id: this.ids.next(),
        name: line(a.name),
        ...this.typeRef(a.type),
        visibility: visibility(a.visibility),
        multiplicity: line(a.multiplicity, 50),
        defaultValue: line(a.defaultValue),
        isStatic: bool(a.isStatic),
        isReadOnly: bool(a.isReadOnly),
        isDerived: bool(a.isDerived),
        isOrdered: bool(a.isOrdered),
        isUnique: bool(a.isUnique),
      });
    });
  }

  operations(raw: Raw): Operation[] {
    return records(raw.operations).map((o) => {
      this.report.members += 1;
      let returnType = { type: '', typeElementId: null as ID | null };
      const parameters: Parameter[] = [];
      for (const p of records(o.parameters)) {
        if (p.direction === 'return') {
          returnType = this.typeRef(p.type);
          continue;
        }
        this.report.members += 1;
        parameters.push(
          makeParameter({
            id: this.ids.next(),
            name: line(p.name),
            ...this.typeRef(p.type),
            direction: p.direction === 'out' || p.direction === 'inout' ? p.direction : 'in',
            multiplicity: line(p.multiplicity, 50),
            defaultValue: line(p.defaultValue),
          }),
        );
      }
      return makeOperation({
        id: this.ids.next(),
        name: line(o.name),
        visibility: visibility(o.visibility),
        returnType: returnType.type,
        returnTypeElementId: returnType.typeElementId,
        isStatic: bool(o.isStatic),
        isAbstract: bool(o.isAbstract),
        isQuery: bool(o.isQuery),
        parameters: parameters.slice(0, 200),
      });
    });
  }

  buildElement(entry: ElementEntry): ModelElement {
    const { raw, id, kind, ownerId } = entry;
    const base = {
      id,
      ownerId,
      name: line(raw.name),
      documentation: text(raw.documentation, 100_000),
      stereotype: this.stereotypeOf(raw.stereotype),
    };
    switch (kind) {
      case 'class':
      case 'interface':
      case 'enumeration':
      case 'dataType':
      case 'primitiveType':
      case 'signal': {
        const features = {
          ...base,
          isAbstract: bool(raw.isAbstract),
          isLeaf: bool(raw.isLeaf),
          visibility: visibility(raw.visibility),
          attributes: this.attributes(raw).slice(0, 500),
          operations: this.operations(raw).slice(0, 500),
        };
        if (kind === 'class') return makeElement('class', { ...features, isActive: bool(raw.isActive) });
        if (kind === 'enumeration') {
          const literals = records(raw.literals)
            .slice(0, 1000)
            .map((l) => {
              this.report.members += 1;
              return makeLiteral({ id: this.ids.next(), name: line(l.name) });
            });
          return makeElement('enumeration', { ...features, literals });
        }
        return makeElement(kind, features);
      }
      case 'actor':
        return makeElement('actor', { ...base, isAbstract: bool(raw.isAbstract) });
      case 'useCase': {
        const extensionPoints = records(raw.extensionPoints)
          .slice(0, 200)
          .map((p) => {
            this.report.members += 1;
            const point = makeExtensionPoint({ id: this.ids.next(), name: line(p.name) });
            if (typeof p._id === 'string') this.extensionPoints.set(p._id, { id: point.id, useCaseId: id });
            return point;
          });
        return makeElement('useCase', { ...base, isAbstract: bool(raw.isAbstract), extensionPoints });
      }
      case 'package':
        return makeElement('package', { ...base, visibility: visibility(raw.visibility) });
      case 'subject':
        return makeElement('subject', base);
      default:
        throw new Error(`Unhandled element kind ${kind}`);
    }
  }

  // ---- Pass 3: relationships -----------------------------------------------------------------

  relationEnd(raw: unknown): Partial<RelationEnd> {
    if (!isPlainObject(raw)) return {};
    const navigable = raw.navigable;
    return {
      name: line(raw.name),
      multiplicity: line(raw.multiplicity, 50),
      aggregation: raw.aggregation === 'shared' || raw.aggregation === 'composite' ? raw.aggregation : 'none',
      navigability:
        navigable === true || navigable === 'navigable'
          ? 'navigable'
          : navigable === false || navigable === 'notNavigable'
            ? 'nonNavigable'
            : 'unspecified',
      visibility: visibility(raw.visibility),
      isOrdered: bool(raw.isOrdered) ?? false,
      isUnique: bool(raw.isUnique) ?? true,
    };
  }

  buildRelationship(raw: Raw): ModelElement | null {
    const type = typeOf(raw);
    const mapping = lookup(RELATIONSHIP_TYPES, type)!;
    const isAssociation = mapping.kind === 'association';
    const sourceRef = isAssociation
      ? refOf(isPlainObject(raw.end1) ? raw.end1.reference : null)
      : refOf(raw.source);
    const targetRef = isAssociation
      ? refOf(isPlainObject(raw.end2) ? raw.end2.reference : null)
      : refOf(raw.target);
    const sourceId = sourceRef ? this.idMap.get(sourceRef) : undefined;
    const targetId = targetRef ? this.idMap.get(targetRef) : undefined;
    if (!sourceId || !targetId) {
      this.countUnsupported(type);
      this.warn(`${this.label(raw)} was skipped: one of its ends is not an imported element`);
      return null;
    }
    const problem = checkRelationshipEndpoints(
      mapping.kind,
      { id: sourceId, kind: this.kinds.get(sourceId)! },
      { id: targetId, kind: this.kinds.get(targetId)! },
    );
    if (problem) {
      this.countUnsupported(type);
      this.warn(
        `${this.label(raw)} was skipped: not a valid ${mapping.kind} between these elements (${problem})`,
      );
      return null;
    }
    const id = this.ids.next();
    this.idMap.set(raw._id as string, id);
    this.kinds.set(id, mapping.kind);
    const base = {
      id,
      // Native rule: relationships are owned by their source element.
      ownerId: sourceId,
      sourceId,
      targetId,
      name: line(raw.name),
      documentation: text(raw.documentation, 100_000),
      stereotype: this.stereotypeOf(raw.stereotype) || mapping.stereotype || '',
    };
    switch (mapping.kind) {
      case 'association':
        return makeElement('association', {
          ...base,
          isDerived: bool(raw.isDerived),
          sourceEnd: this.relationEnd(raw.end1),
          targetEnd: this.relationEnd(raw.end2),
        });
      case 'extend': {
        const extensionPointIds = (Array.isArray(raw.extensionLocations) ? raw.extensionLocations : [])
          .map(refOf)
          .map((ref) => (ref ? this.extensionPoints.get(ref) : undefined))
          .filter((p): p is { id: ID; useCaseId: ID } => p?.useCaseId === targetId)
          .map((p) => p.id);
        return makeElement('extend', { ...base, condition: line(raw.condition), extensionPointIds });
      }
      default:
        return makeElement(mapping.kind, base);
    }
  }

  // ---- Pass 4: diagrams and views ------------------------------------------------------------

  buildDiagram(raw: Raw, contextId: ID, kind: DiagramKind) {
    const info = DIAGRAM_KIND_INFO[kind];
    const diagram = makeDiagram({
      id: this.ids.next(),
      kind,
      name: line(raw.name) || typeOf(raw),
      ownerId: this.nearestPackage(contextId),
      documentation: text(raw.documentation, 100_000),
    });
    const viewIds = new Map<string, ID>();
    const nodes: DiagramView[] = [];
    const later: DiagramView[] = [];
    const views = records(raw.ownedViews).slice(0, 50_000);
    const isEdge = (v: Raw) => 'head' in v || 'tail' in v;

    const box = (v: Raw, min: number) => {
      const x = finite(v.left);
      const y = finite(v.top);
      const width = finite(v.width);
      const height = finite(v.height);
      if (x === null || y === null || width === null || height === null) return null;
      return {
        x: clampCoord(x),
        y: clampCoord(y),
        width: clampSize(width, min),
        height: clampSize(height, min),
      };
    };
    const style = (v: Raw): ViewStyle => {
      const s: ViewStyle = {};
      const fill = color(v.fillColor, DEFAULT_COLORS.fill);
      const stroke = color(v.lineColor, DEFAULT_COLORS.stroke);
      const textColor = color(v.fontColor, DEFAULT_COLORS.textColor);
      if (fill) s.fill = fill;
      if (stroke) s.stroke = stroke;
      if (textColor) s.textColor = textColor;
      return s;
    };

    for (const v of views) {
      const type = typeOf(v);
      if (typeof v._id !== 'string' || isEdge(v)) continue;
      if (type === 'UMLNoteView') {
        const geometry = box(v, 20);
        if (!geometry) {
          this.countUnsupported(type);
          continue;
        }
        const id = this.ids.next();
        viewIds.set(v._id, id);
        later.push(makeView('note', { id, text: text(v.text, 20_000), ...geometry, style: style(v) }));
        this.countImported(type);
        continue;
      }
      const modelRef = refOf(v.model);
      const elementId = modelRef ? this.idMap.get(modelRef) : undefined;
      const elementKind = elementId ? this.kinds.get(elementId) : undefined;
      if (!elementId || !elementKind) {
        this.countUnsupported(type);
        continue;
      }
      if (!(info.nodeKinds as readonly string[]).includes(elementKind)) {
        this.countUnsupported(type);
        this.warn(
          `${type} of a ${elementKind} is not shown: not allowed in a ${kind} diagram ("${diagram.name}")`,
        );
        continue;
      }
      const geometry = box(v, 10);
      if (!geometry) {
        this.countUnsupported(type);
        this.warn(`${type} in "${diagram.name}" has no usable geometry`);
        continue;
      }
      const hidden: Compartment[] = [];
      if (v.suppressAttributes === true) hidden.push('attributes');
      if (v.suppressOperations === true) hidden.push('operations');
      if (v.suppressLiterals === true) hidden.push('literals');
      // StarUML draws interfaces as an icon (ball) by default and actors as a stick figure.
      const display = v.stereotypeDisplay;
      const alternate =
        (elementKind === 'interface' && display === 'icon') ||
        (elementKind === 'actor' && (display === 'label' || display === 'decoration'));
      const id = this.ids.next();
      viewIds.set(v._id, id);
      nodes.push(
        makeView('node', {
          id,
          elementId,
          ...geometry,
          hiddenCompartments: hidden,
          variant: alternate ? 'alternate' : 'default',
          style: style(v),
        }),
      );
      this.countImported(type);
    }

    // Containers first (larger areas below smaller ones), then notes.
    const area = (v: DiagramView) => (v.kind === 'node' ? v.width * v.height : 0);
    const ordered = [...nodes].sort((a, b) => area(b) - area(a));
    const placed = new Map<ID, DiagramView>([...ordered, ...later].map((v) => [v.id, v]));
    const edges: DiagramView[] = [];

    for (const v of views) {
      const type = typeOf(v);
      if (typeof v._id !== 'string' || !isEdge(v)) continue;
      const tail = viewIds.get(refOf(v.tail) ?? '');
      const head = viewIds.get(refOf(v.head) ?? '');
      if (type === 'UMLNoteLinkView') {
        const tailView = tail ? placed.get(tail) : undefined;
        const headView = head ? placed.get(head) : undefined;
        const [note, other] = tailView?.kind === 'note' ? [tailView, headView] : [headView, tailView];
        if (note?.kind !== 'note' || !other || other.id === note.id) {
          this.countUnsupported(type);
          continue;
        }
        edges.push(
          makeView('noteLink', { id: this.ids.next(), sourceViewId: note.id, targetViewId: other.id }),
        );
        this.countImported(type);
        continue;
      }
      const relRef = refOf(v.model);
      const relId = relRef ? this.idMap.get(relRef) : undefined;
      const rel = relId ? this.elements[relId] : undefined;
      if (!rel || !('sourceId' in rel)) {
        this.countUnsupported(type);
        continue;
      }
      if (!info.relationshipKinds.includes(rel.kind as RelationshipKind)) {
        this.countUnsupported(type);
        this.warn(
          `${type} of a ${rel.kind} is not shown: not allowed in a ${kind} diagram ("${diagram.name}")`,
        );
        continue;
      }
      const tailView = tail ? placed.get(tail) : undefined;
      const headView = head ? placed.get(head) : undefined;
      const elementOf = (view: DiagramView | undefined) => (view?.kind === 'node' ? view.elementId : null);
      let points = parsePoints(v.points).slice(1, -1);
      let source = tailView;
      let target = headView;
      if (elementOf(tailView) !== rel.sourceId || elementOf(headView) !== rel.targetId) {
        if (elementOf(headView) === rel.sourceId && elementOf(tailView) === rel.targetId) {
          source = headView;
          target = tailView;
          points = points.reverse();
        } else {
          this.countUnsupported(type);
          this.warn(`${type} in "${diagram.name}" is not attached to views of its relationship's ends`);
          continue;
        }
      }
      edges.push(
        makeView('edge', {
          id: this.ids.next(),
          elementId: rel.id,
          sourceViewId: source!.id,
          targetViewId: target!.id,
          waypoints: points.slice(0, 200),
          style: style(v),
        }),
      );
      this.countImported(type);
    }

    for (const v of views) {
      if (typeof v._id !== 'string') this.countUnsupported(typeOf(v));
    }
    for (const view of [...ordered, ...later, ...edges]) diagram.views[view.id] = view;
    this.report.views += Object.keys(diagram.views).length;
    return diagram;
  }
}

/** Assign visual containers geometrically, like the editor does after a move. */
function assignContainers(doc: ProjectDocument): void {
  for (const diagram of Object.values(doc.diagrams)) {
    for (const view of Object.values(diagram.views)) {
      if (view.kind !== 'node' && view.kind !== 'note') continue;
      view.containerViewId = findContainerFor(doc, diagram, view)?.id ?? null;
    }
  }
}

export function importMdj(source: string, options: MdjImportOptions): MdjImportResult {
  const fail = (code: MdjImportErrorCode, details: string[] = []): MdjImportResult => ({
    ok: false,
    error: { code, details },
  });
  const maxBytes = options.maxBytes ?? MAX_PROJECT_BYTES;
  if (source.length > maxBytes)
    return fail('tooLarge', [`File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`]);
  const trimmed = source.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return fail('empty');
  const scan = scanJson(trimmed);
  if (scan.maxDepthExceeded) return fail('tooDeep', ['JSON nesting is too deep']);
  if (scan.duplicateKeys.length)
    return fail(
      'duplicateKeys',
      scan.duplicateKeys.map((k) => `Duplicate key "${k}"`),
    );
  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch (error) {
    return fail('invalidJson', [error instanceof Error ? error.message : String(error)]);
  }
  if (!isPlainObject(root) || root._type !== 'Project' || !Array.isArray(root.ownedElements)) {
    return fail('notMdj', ['Expected a StarUML project: { "_type": "Project", "ownedElements": [...] }']);
  }

  const projectName = line(root.name, 200) || options.fileName?.replace(/\.mdj$/i, '') || 'Imported project';
  const models = records(root.ownedElements).filter((r) => r._type === 'UMLModel');
  const base = createEmptyProject({
    name: projectName,
    modelName: line(models[0]?.name) || 'Model',
    ids: options.ids,
    now: options.now,
  });
  const tx = new Translation(options.ids, base.rootModelId, projectName);

  // Index every record with an _id (bounded) so references can be resolved by name.
  let visited = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const value = stack.pop();
    visited += 1;
    if (visited > MAX_RECORDS) return fail('tooLarge', [`More than ${MAX_RECORDS} records`]);
    if (Array.isArray(value)) stack.push(...value);
    else if (isPlainObject(value)) {
      if (typeof value._id === 'string') {
        if (tx.byId.has(value._id))
          tx.warn(`Duplicate _id "${value._id.slice(0, 40)}": the first record wins`);
        else tx.byId.set(value._id, value);
      }
      for (const [key, child] of Object.entries(value))
        if (key !== '_parent' && typeof child === 'object') stack.push(child);
    }
  }

  // The first UMLModel becomes the native root model; further models become packages.
  for (const raw of records(root.ownedElements)) {
    if (raw === models[0] && typeof raw._id === 'string') {
      tx.idMap.set(raw._id, base.rootModelId);
      tx.countImported('UMLModel');
      tx.walk(raw.ownedElements, base.rootModelId);
    } else if (raw._type === 'UMLModel') {
      tx.warn(`Additional model "${line(raw.name, 80)}" was imported as a package`);
      tx.walk([raw], base.rootModelId);
    } else {
      tx.walk([raw], base.rootModelId);
    }
  }

  const elements: Record<ID, ModelElement> = { [base.rootModelId]: base.modelElements[base.rootModelId]! };
  try {
    const rootModel = elements[base.rootModelId]!;
    const model = models[0];
    if (model) {
      rootModel.documentation = text(model.documentation, 100_000);
      rootModel.stereotype = tx.stereotypeOf(model.stereotype);
    }
    for (const entry of tx.entries) {
      elements[entry.id] = tx.buildElement(entry);
      tx.countImported(typeOf(entry.raw));
    }
    Object.assign(tx.elements, elements);
    for (const raw of tx.relationships) {
      const rel = tx.buildRelationship(raw);
      if (!rel) continue;
      elements[rel.id] = rel;
      tx.elements[rel.id] = rel;
      tx.countImported(typeOf(raw));
    }
  } catch (error) {
    return fail('invalid', [error instanceof Error ? error.message : String(error)]);
  }

  const diagrams: ProjectDocument['diagrams'] = {};
  for (const { raw, contextId } of tx.diagrams) {
    const kind = lookup(DIAGRAM_TYPES, typeOf(raw))!;
    try {
      const diagram = tx.buildDiagram(raw, contextId, kind);
      diagrams[diagram.id] = diagram;
      tx.countImported(typeOf(raw));
    } catch (error) {
      tx.countUnsupported(typeOf(raw));
      tx.warn(
        `Diagram "${line(raw.name, 80)}" could not be imported: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const doc: ProjectDocument = { ...base, modelElements: elements, diagrams };
  assignContainers(doc);
  const parsed = ProjectDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    return fail(
      'invalid',
      parsed.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`),
    );
  }
  const integrity = checkIntegrity(parsed.data);
  if (integrity.length)
    return fail(
      'invalid',
      integrity.slice(0, 20).map((i) => i.message),
    );

  tx.report.elements = Object.keys(parsed.data.modelElements).length - 1;
  tx.report.diagrams = Object.keys(parsed.data.diagrams).length;
  return { ok: true, doc: parsed.data, report: tx.report };
}
