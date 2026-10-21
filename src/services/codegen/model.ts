import type { ID } from '@/domain/schemas/common';
import { isRelationship, type ElementOf, type ModelElement } from '@/domain/schemas/elements';
import type { Visibility } from '@/domain/schemas/common';
import type { ProjectDocument } from '@/domain/schemas/project';
import { isCollectionMultiplicity } from '@/domain/notation/multiplicity';
import { ancestorIds } from '@/domain/services/queries';

/** Language-neutral view of the class model used by all code generators. */
export interface CgType {
  name: string;
  collection: boolean;
  /** Referenced classifier in the model (for imports), if any. */
  classifierId: ID | null;
}

export interface CgField {
  name: string;
  type: CgType;
  visibility: Visibility;
  isStatic: boolean;
  isReadOnly: boolean;
  defaultValue: string;
  documentation: string;
}

export interface CgParam {
  name: string;
  type: CgType;
  direction: 'in' | 'out' | 'inout' | 'return';
  defaultValue: string;
}

export interface CgMethod {
  name: string;
  visibility: Visibility;
  isStatic: boolean;
  isAbstract: boolean;
  returnType: CgType | null;
  params: CgParam[];
  documentation: string;
}

export interface CgClassifier {
  id: ID;
  kind: 'class' | 'interface' | 'enum';
  name: string;
  /** Package path from the root model (excluded), e.g. ["domain", "orders"]. */
  packagePath: string[];
  isAbstract: boolean;
  isFinal: boolean;
  documentation: string;
  extends: ID[];
  implements: ID[];
  fields: CgField[];
  methods: CgMethod[];
  literals: string[];
}

export interface CgModel {
  classifiers: CgClassifier[];
  byId: Map<ID, CgClassifier>;
}

type Classifier = ElementOf<'class' | 'interface' | 'enumeration' | 'dataType' | 'signal'>;
const KINDS = new Set(['class', 'interface', 'enumeration', 'dataType', 'signal']);

function typeOf(doc: ProjectDocument, text: string, multiplicity: string, classifierId: ID | null): CgType {
  const ref = classifierId && doc.modelElements[classifierId] ? classifierId : null;
  return {
    name: (ref ? doc.modelElements[ref]!.name : text).trim(),
    collection: isCollectionMultiplicity(multiplicity),
    classifierId: ref,
  };
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

export function extractModel(doc: ProjectDocument, scope?: ReadonlySet<ID>): CgModel {
  const elements = Object.values(doc.modelElements).filter(
    (e): e is Classifier => KINDS.has(e.kind) && (!scope || scope.has(e.id)),
  );
  const classifiers: CgClassifier[] = elements.map((el) => {
    const packagePath = ancestorIds(doc, el.id)
      .reverse()
      .slice(1) // skip the root model
      .map((id) => doc.modelElements[id])
      .filter((e): e is ModelElement => !!e && (e.kind === 'package' || e.kind === 'profile'))
      .map((e) => e.name);
    return {
      id: el.id,
      kind: el.kind === 'interface' ? 'interface' : el.kind === 'enumeration' ? 'enum' : 'class',
      name: el.name,
      packagePath,
      isAbstract: el.isAbstract,
      isFinal: el.isLeaf,
      documentation: el.documentation,
      extends: [],
      implements: [],
      fields: el.attributes.map((a) => ({
        name: a.name,
        type: typeOf(doc, a.type, a.multiplicity, a.typeElementId),
        visibility: a.visibility,
        isStatic: a.isStatic,
        isReadOnly: a.isReadOnly,
        defaultValue: a.defaultValue,
        documentation: '',
      })),
      methods: el.operations.map((o) => ({
        name: o.name,
        visibility: o.visibility,
        isStatic: o.isStatic,
        isAbstract: o.isAbstract || el.kind === 'interface',
        returnType: o.returnType.trim() ? typeOf(doc, o.returnType, '', o.returnTypeElementId) : null,
        params: o.parameters
          .filter((p) => p.direction !== 'return')
          .map((p) => ({
            name: p.name,
            type: typeOf(doc, p.type, p.multiplicity, p.typeElementId),
            direction: p.direction,
            defaultValue: p.defaultValue,
          })),
        documentation: '',
      })),
      literals: el.kind === 'enumeration' ? el.literals.map((l) => l.name) : [],
    };
  });
  const byId = new Map(classifiers.map((c) => [c.id, c]));
  for (const rel of Object.values(doc.modelElements)) {
    if (!isRelationship(rel)) continue;
    const source = byId.get(rel.sourceId);
    const target = byId.get(rel.targetId);
    if (!source || !target) continue;
    if (rel.kind === 'generalization') source.extends.push(target.id);
    if (rel.kind === 'realization' && target.kind === 'interface') source.implements.push(target.id);
    if (rel.kind === 'association') {
      // Navigable, named (or explicitly navigable) ends become fields of the opposite classifier.
      const ends: Array<[CgClassifier, CgClassifier, typeof rel.targetEnd]> = [
        [source, target, rel.targetEnd],
        [target, source, rel.sourceEnd],
      ];
      for (const [owner, other, end] of ends) {
        if (end.navigability === 'nonNavigable') continue;
        if (!end.name && end.navigability !== 'navigable') continue;
        if (owner.kind === 'enum') continue;
        const collection = isCollectionMultiplicity(end.multiplicity);
        const name = end.name || lowerFirst(other.name) + (collection ? 's' : '');
        if (owner.fields.some((f) => f.name === name)) continue;
        owner.fields.push({
          name,
          type: { name: other.name, collection, classifierId: other.id },
          visibility: end.visibility === 'public' ? 'private' : end.visibility,
          isStatic: false,
          isReadOnly: false,
          defaultValue: '',
          documentation: '',
        });
      }
    }
  }
  classifiers.sort((a, b) =>
    [...a.packagePath, a.name].join('/').localeCompare([...b.packagePath, b.name].join('/')),
  );
  completeContracts(classifiers, byId);
  return { classifiers, byId };
}

/**
 * Skeletons must compile: a class realizing an interface receives stubs for interface members it does
 * not declare, and a concrete class receives stubs for abstract operations inherited from ancestors.
 */
function completeContracts(classifiers: CgClassifier[], byId: Map<ID, CgClassifier>): void {
  const interfaceClosure = (ids: ID[], seen = new Set<ID>()): CgClassifier[] => {
    const result: CgClassifier[] = [];
    for (const id of ids) {
      const itf = byId.get(id);
      if (!itf || seen.has(id)) continue;
      seen.add(id);
      result.push(itf, ...interfaceClosure(itf.extends, seen));
    }
    return result;
  };
  const ancestors = (c: CgClassifier, seen = new Set<ID>()): CgClassifier[] => {
    const result: CgClassifier[] = [];
    for (const id of c.extends) {
      const parent = byId.get(id);
      if (!parent || seen.has(id)) continue;
      seen.add(id);
      result.push(parent, ...ancestors(parent, seen));
    }
    return result;
  };
  for (const c of classifiers) {
    if (c.kind !== 'class') continue;
    const chain = ancestors(c);
    const declares = (name: string) =>
      c.methods.some((m) => m.name === name) ||
      chain.some((a) => a.methods.some((m) => m.name === name && !m.isAbstract));
    const hasField = (name: string) =>
      c.fields.some((f) => f.name === name) || chain.some((a) => a.fields.some((f) => f.name === name));
    const interfaces = interfaceClosure([...c.implements, ...chain.flatMap((a) => a.implements)]);
    for (const itf of interfaces) {
      for (const f of itf.fields) if (!hasField(f.name)) c.fields.push({ ...f, visibility: 'public' });
      for (const m of itf.methods) {
        if (m.isStatic || declares(m.name)) continue;
        c.methods.push({
          ...m,
          isAbstract: c.isAbstract,
          visibility: 'public',
          documentation: `Realizes ${itf.name}.${m.name}`,
        });
      }
    }
    if (!c.isAbstract) {
      for (const parent of chain) {
        for (const m of parent.methods) {
          if (m.isAbstract && !m.isStatic && !declares(m.name))
            c.methods.push({ ...m, isAbstract: false, documentation: `Overrides ${parent.name}.${m.name}` });
        }
      }
    }
  }
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationResult {
  files: GeneratedFile[];
  warnings: string[];
}

/** Make an identifier legal: invalid characters → "_", reserved words get a trailing "_". */
export function sanitizeIdentifier(
  raw: string,
  reserved: ReadonlySet<string>,
  warnings: string[],
  context: string,
  fallback = 'unnamed',
): string {
  let name = raw.trim().replace(/[^\p{L}\p{N}_$]/gu, '_');
  if (!name) {
    warnings.push(`${context}: empty name replaced by "${fallback}"`);
    name = fallback;
  }
  if (/^\p{N}/u.test(name)) name = `_${name}`;
  if (reserved.has(name)) {
    warnings.push(`${context}: "${name}" is a reserved word, renamed to "${name}_"`);
    name = `${name}_`;
  } else if (name !== raw.trim()) {
    warnings.push(`${context}: "${raw}" sanitized to "${name}"`);
  }
  return name;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const QUOTED = /^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/;

/**
 * Default values are free text in the model. Only literals are emitted verbatim; anything else becomes
 * a string literal (with a warning) so generated code always parses — user text is never executed.
 */
export function safeLiteral(
  raw: string,
  language: 'ts' | 'java' | 'python',
  warnings: string[],
  context: string,
): string {
  const text = raw.trim();
  if (NUMBER.test(text)) return text;
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === 'false')
    return language === 'python' ? (lower === 'true' ? 'True' : 'False') : lower;
  if (lower === 'null' || lower === 'none') return language === 'python' ? 'None' : 'null';
  if (QUOTED.test(text)) return JSON.stringify(text.slice(1, -1));
  warnings.push(`${context}: default "${text}" is not a literal; emitted as a string`);
  return JSON.stringify(text);
}

/** Make generated names unique within a scope (duplicate member names). */
export function uniqueIn(used: Set<string>, name: string): string {
  let candidate = name;
  for (let i = 2; used.has(candidate); i += 1) candidate = `${name}${i}`;
  used.add(candidate);
  return candidate;
}
