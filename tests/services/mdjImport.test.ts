// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '@/domain/ids';
import type { ModelElement } from '@/domain/schemas/elements';
import type { ProjectDocument } from '@/domain/schemas/project';
import type { DiagramView } from '@/domain/schemas/views';
import { parseProjectText, serializeProject } from '@/domain/serialization/projectFile';
import { checkIntegrity } from '@/domain/services/integrity';
import { validateProject } from '@/domain/validation/rules';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { importMdj, type MdjImportResult } from '@/services/import/mdjImport';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/mdj/${name}`, import.meta.url), 'utf8');
const run = (text: string, maxBytes?: number): MdjImportResult =>
  importMdj(text, { ids: sequentialIds('imp'), now: new Date('2026-01-01T00:00:00.000Z'), maxBytes });

function imported(text: string) {
  const result = run(text);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.details.join('; ')}`);
  return result;
}

function named(doc: ProjectDocument, name: string, kind?: string): ModelElement {
  const found = Object.values(doc.modelElements).filter((e) => e.name === name && (!kind || e.kind === kind));
  if (found.length !== 1) throw new Error(`expected one element "${name}", found ${found.length}`);
  return found[0]!;
}

function viewsOf(doc: ProjectDocument, diagramName: string): DiagramView[] {
  const diagram = Object.values(doc.diagrams).find((d) => d.name === diagramName);
  if (!diagram) throw new Error(`no diagram ${diagramName}`);
  return Object.values(diagram.views);
}

function nodeViewOf(doc: ProjectDocument, diagramName: string, elementName: string) {
  const el = named(doc, elementName);
  const view = viewsOf(doc, diagramName).find((v) => v.kind === 'node' && v.elementId === el.id);
  if (view?.kind !== 'node') throw new Error(`no view of ${elementName}`);
  return view;
}

describe('StarUML .mdj import (experimental, hand-written fixtures)', () => {
  it('translates a class model: packages, classifiers, members and typed references', () => {
    const { doc, report } = imported(fixture('class-model.mdj'));
    expect(doc.name).toBe('Shop');
    const root = doc.modelElements[doc.rootModelId]!;
    expect(root).toMatchObject({ kind: 'model', name: 'Model', documentation: 'Hand-written fixture' });

    const pkg = named(doc, 'domain', 'package');
    const customer = named(doc, 'Customer');
    const order = named(doc, 'Order');
    const line = named(doc, 'OrderLine');
    const status = named(doc, 'OrderStatus');
    expect(customer).toMatchObject({
      kind: 'class',
      ownerId: pkg.id,
      stereotype: 'entity',
      documentation: 'A registered buyer.',
    });
    if (customer.kind !== 'class') throw new Error('class');
    expect(customer.attributes.map((a) => [a.name, a.visibility, a.type, a.multiplicity])).toEqual([
      ['name', 'private', 'String', ''],
      ['email', 'private', 'String', '0..1'],
      ['count', 'public', 'Integer', ''],
    ]);
    expect(customer.attributes[2]).toMatchObject({ isStatic: true, defaultValue: '0' });
    const place = customer.operations[0]!;
    expect(place).toMatchObject({ name: 'placeOrder', returnType: 'Order', returnTypeElementId: order.id });
    expect(place.parameters).toHaveLength(1);
    expect(place.parameters[0]).toMatchObject({
      name: 'lines',
      type: 'OrderLine',
      typeElementId: line.id,
      multiplicity: '*',
    });

    if (order.kind !== 'class') throw new Error('class');
    expect(order.attributes[0]).toMatchObject({ name: 'total', visibility: 'protected', isReadOnly: true });
    expect(order.attributes[1]).toMatchObject({
      name: 'status',
      type: 'OrderStatus',
      typeElementId: status.id,
    });
    expect(status.kind === 'enumeration' && status.literals.map((l) => l.name)).toEqual([
      'NEW',
      'PAID',
      'SHIPPED',
    ]);
    const payable = named(doc, 'Payable');
    expect(payable.kind === 'interface' && payable.operations[0]).toMatchObject({
      name: 'pay',
      returnType: 'Boolean',
      isAbstract: true,
    });
    expect(named(doc, 'SpecialOrder')).toMatchObject({ isAbstract: true });

    // A class nested in a class cannot be owned there natively: it moves to the nearest package.
    expect(named(doc, 'Entry')).toMatchObject({ kind: 'class', ownerId: doc.rootModelId });
    expect(report.warnings.some((w) => w.includes('UMLClass "Entry"'))).toBe(true);
    expect(report.members).toBe(12);
  });

  it('translates relationships with correct direction, ends and ownership', () => {
    const { doc, report } = imported(fixture('class-model.mdj'));
    const ids = (name: string) => named(doc, name).id;
    const rels = Object.values(doc.modelElements).filter((e) => 'sourceId' in e);
    const find = (kind: string, source: string, target: string) => {
      const match = rels.find(
        (r) => r.kind === kind && 'sourceId' in r && r.sourceId === ids(source) && r.targetId === ids(target),
      );
      if (!match) throw new Error(`no ${kind} ${source}→${target}`);
      return match;
    };
    const places = find('association', 'Customer', 'Order');
    expect(places).toMatchObject({
      name: 'places',
      ownerId: ids('Customer'),
      sourceEnd: { name: 'buyer', multiplicity: '1', navigability: 'unspecified', aggregation: 'none' },
      targetEnd: { name: 'orders', multiplicity: '0..*', navigability: 'navigable' },
    });
    expect(find('association', 'Order', 'OrderLine')).toMatchObject({
      sourceEnd: { aggregation: 'composite', multiplicity: '1' },
      targetEnd: { name: 'lines', multiplicity: '1..*', navigability: 'navigable' },
    });
    find('generalization', 'SpecialOrder', 'Order');
    find('realization', 'Order', 'Payable');
    find('dependency', 'Customer', 'Logger');
    expect(rels).toHaveLength(5);
    // The dependency towards a missing element is reported, not imported.
    expect(report.warnings.some((w) => w.includes('UMLDependency "toNowhere" was skipped'))).toBe(true);
  });

  it('translates the class diagram: geometry, containment, notes, edge waypoints and styles', () => {
    const { doc } = imported(fixture('class-model.mdj'));
    const diagram = Object.values(doc.diagrams)[0]!;
    expect(diagram).toMatchObject({ kind: 'class', name: 'Main', ownerId: doc.rootModelId });
    const views = Object.values(diagram.views);
    expect(views.filter((v) => v.kind === 'node')).toHaveLength(8);
    expect(views.filter((v) => v.kind === 'edge')).toHaveLength(5);
    expect(views.filter((v) => v.kind === 'note')).toHaveLength(1);
    expect(views.filter((v) => v.kind === 'noteLink')).toHaveLength(1);

    const pkgView = nodeViewOf(doc, 'Main', 'domain');
    const customerView = nodeViewOf(doc, 'Main', 'Customer');
    expect(customerView).toMatchObject({
      x: 60,
      y: 80,
      width: 200,
      height: 100,
      containerViewId: pkgView.id,
    });
    expect(customerView.style).toEqual({ fill: '#fff2cc' });
    expect(pkgView.style).toEqual({}); // StarUML default colours are not copied (themes stay usable)
    expect(views[0]!.id).toBe(pkgView.id); // containers are stacked below their contents
    expect(nodeViewOf(doc, 'Main', 'Logger').containerViewId).toBeNull();
    expect(nodeViewOf(doc, 'Main', 'OrderLine').hiddenCompartments).toEqual(['operations']);
    expect(nodeViewOf(doc, 'Main', 'Payable').variant).toBe('alternate');

    // The composition view is drawn tail=OrderLine → head=Order: it is re-oriented to the
    // relationship (source Order) and its inner bend points are reversed accordingly.
    const composition = Object.values(doc.modelElements).find(
      (e) => e.kind === 'association' && e.sourceEnd.aggregation === 'composite',
    )!;
    const compositionEdge = views.find((v) => v.kind === 'edge' && v.elementId === composition.id);
    expect(compositionEdge).toMatchObject({
      sourceViewId: nodeViewOf(doc, 'Main', 'Order').id,
      targetViewId: nodeViewOf(doc, 'Main', 'OrderLine').id,
      waypoints: [
        { x: 540, y: 300 },
        { x: 520, y: 300 },
      ],
    });
    const note = views.find((v) => v.kind === 'note');
    expect(note).toMatchObject({ text: 'Prices include VAT' });
    expect(views.find((v) => v.kind === 'noteLink')).toMatchObject({
      sourceViewId: note!.id,
      targetViewId: nodeViewOf(doc, 'Main', 'Order').id,
    });
  });

  it('reports unsupported constructs instead of rendering them', () => {
    const { report } = imported(fixture('class-model.mdj'));
    expect(report.unsupported).toMatchObject({
      UMLCollaboration: 1,
      UMLInteraction: 1,
      UMLSequenceDiagram: 1,
      UMLStateMachine: 1,
      UMLStatechartDiagram: 1,
      UMLTextView: 1,
      UMLDependency: 1,
    });
    expect(report.imported).toMatchObject({
      UMLModel: 1,
      UMLPackage: 1,
      UMLClass: 6,
      UMLClassDiagram: 1,
      UMLAssociation: 2,
      UMLClassView: 5,
      UMLAssociationView: 2,
      UMLNoteView: 1,
      UMLNoteLinkView: 1,
    });
    expect(report).toMatchObject({ elements: 14, diagrams: 1, views: 15 });
  });

  it('produces a native project that saves, reopens, validates and exports', () => {
    const { doc } = imported(fixture('class-model.mdj'));
    expect(checkIntegrity(doc)).toEqual([]);
    const reopened = parseProjectText(serializeProject(doc));
    expect(reopened.ok && reopened.doc).toEqual(doc);
    expect(() => validateProject(doc)).not.toThrow();
    const diagramId = Object.keys(doc.diagrams)[0]!;
    const { svg } = renderDiagramSvg(doc, diagramId);
    for (const text of ['Customer', '«entity»', 'OrderStatus', 'NEW', 'Prices include VAT', 'buyer', '0..*'])
      expect(svg).toContain(text);
    // Fresh native identifiers; StarUML ids (with "+", "=") are never reused.
    expect(JSON.stringify(doc)).not.toContain('AAAAAAFF');
  });

  it('is deterministic for a given id generator', () => {
    expect(imported(fixture('class-model.mdj')).doc).toEqual(imported(fixture('class-model.mdj')).doc);
  });

  it('translates a use case model: subject (visual container), include, extend with extension point', () => {
    const { doc, report } = imported(fixture('use-case.mdj'));
    expect(doc.name).toBe('Store use cases');
    expect(doc.modelElements[doc.rootModelId]!.name).toBe('Requirements');
    const checkout = named(doc, 'Checkout');
    const login = named(doc, 'Log in');
    const coupon = named(doc, 'Apply coupon');
    const rels = Object.values(doc.modelElements).filter((e) => 'sourceId' in e);
    expect(rels.find((r) => r.kind === 'include')).toMatchObject({
      sourceId: checkout.id,
      targetId: login.id,
    });
    const extend = rels.find((r) => r.kind === 'extend');
    expect(extend).toMatchObject({
      sourceId: coupon.id,
      targetId: checkout.id,
      condition: 'coupon entered',
      extensionPointIds: [checkout.kind === 'useCase' ? checkout.extensionPoints[0]!.id : ''],
    });
    expect(rels.find((r) => r.kind === 'association')).toMatchObject({ sourceId: named(doc, 'Customer').id });
    expect(rels.find((r) => r.kind === 'generalization')).toMatchObject({
      sourceId: named(doc, 'Clerk').id,
      targetId: named(doc, 'Customer').id,
    });
    const subjectView = nodeViewOf(doc, 'Shopping', 'Web shop');
    expect(nodeViewOf(doc, 'Shopping', 'Checkout').containerViewId).toBe(subjectView.id);
    expect(checkout.ownerId).toBe(doc.rootModelId); // boundary is visual only
    expect(nodeViewOf(doc, 'Shopping', 'Clerk').variant).toBe('alternate');
    expect(nodeViewOf(doc, 'Shopping', 'Customer').variant).toBe('default');
    expect(viewsOf(doc, 'Shopping').filter((v) => v.kind === 'edge')).toHaveLength(4);
    expect(report.unsupported).toEqual({});
    expect(report.warnings).toEqual([]);
    expect(checkIntegrity(doc)).toEqual([]);
  });

  describe('untrusted input', () => {
    it('rejects files that are not StarUML projects with a specific code', () => {
      const code = (text: string, maxBytes?: number) => {
        const result = run(text, maxBytes);
        return result.ok ? 'ok' : result.error.code;
      };
      expect(code('')).toBe('empty');
      expect(code('{ "_type": "Project", ')).toBe('invalidJson');
      expect(code('{"format":"uml-studio-project"}')).toBe('notMdj');
      expect(code('[]')).toBe('notMdj');
      expect(code('{"_type":"Project","ownedElements":[],"name":"a","name":"b"}')).toBe('duplicateKeys');
      expect(code(`${'['.repeat(300)}${']'.repeat(300)}`)).toBe('tooDeep');
      expect(code(fixture('use-case.mdj'), 1000)).toBe('tooLarge');
      expect(code('{"_type":"Project","ownedElements":[]}')).toBe('ok');
    });

    it('survives hostile and malformed records without producing an invalid project', () => {
      const hostile = {
        _type: 'Project',
        _id: 'p',
        name: { not: 'a string' },
        ownedElements: [
          {
            _type: 'UMLModel',
            _id: 'm',
            name: 'M',
            ownedElements: [
              {
                _type: 'UMLClass',
                _id: 'c1',
                name: 42,
                attributes: 'nope',
                operations: [null, 3, { name: 'op\u0000x' }],
              },
              { _type: 'UMLClass', _id: 'c1', name: 'duplicate id' },
              { _type: 'toString', _id: 'proto' },
              { _type: '__proto__', _id: 'proto2' },
              { _type: 'UMLClass', name: 'no id' },
              { _type: 'UMLUseCase', _id: 'uc', name: 'UC' },
              { _type: 'UMLInclude', _id: 'bad-include', source: { $ref: 'c1' }, target: { $ref: 'uc' } },
              { _type: 'UMLGeneralization', _id: 'self', source: { $ref: 'c1' }, target: { $ref: 'c1' } },
              {
                _type: 'UMLClassDiagram',
                _id: 'd',
                name: 'D',
                ownedViews: [
                  {
                    _type: 'UMLClassView',
                    _id: 'v1',
                    model: { $ref: 'c1' },
                    left: 1e12,
                    top: -1e12,
                    width: -5,
                    height: 1e9,
                  },
                  {
                    _type: 'UMLClassView',
                    _id: 'v2',
                    model: { $ref: 'c1' },
                    left: '10',
                    top: 0,
                    width: 10,
                    height: 10,
                  },
                  {
                    _type: 'UMLUseCaseView',
                    _id: 'v3',
                    model: { $ref: 'uc' },
                    left: 0,
                    top: 0,
                    width: 10,
                    height: 10,
                  },
                  {
                    _type: 'UMLClassView',
                    _id: 'v4',
                    model: { $ref: 'missing' },
                    left: 0,
                    top: 0,
                    width: 10,
                    height: 10,
                  },
                  {
                    _type: 'UMLIncludeView',
                    _id: 'v5',
                    model: { $ref: 'bad-include' },
                    head: { $ref: 'v1' },
                    tail: { $ref: 'v3' },
                  },
                  { _type: 'UMLNoteLinkView', _id: 'v6', head: { $ref: 'v1' }, tail: { $ref: 'v1' } },
                  'not an object',
                ],
              },
            ],
          },
        ],
      };
      const result = run(JSON.stringify(hostile));
      if (!result.ok) throw new Error(result.error.details.join('; '));
      const { doc, report } = result;
      expect(checkIntegrity(doc)).toEqual([]);
      expect(doc.name).toBe('Imported project');
      const classes = Object.values(doc.modelElements).filter((e) => e.kind === 'class');
      expect(classes).toHaveLength(1);
      expect(classes[0]).toMatchObject({ name: '', attributes: [] });
      expect(classes[0]!.kind === 'class' && classes[0]!.operations.map((o) => o.name)).toEqual(['opx']);
      expect(Object.values(doc.modelElements).some((e) => 'sourceId' in e)).toBe(false);
      const views = Object.values(Object.values(doc.diagrams)[0]!.views);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ x: 1_000_000, y: -1_000_000, width: 10, height: 100_000 });
      expect(report.unsupported).toMatchObject({
        toString: 1,
        '(invalid type)': 1,
        UMLInclude: 1,
        UMLGeneralization: 1,
      });
      expect(Object.getPrototypeOf(report.unsupported)).toBe(Object.prototype);
      expect(report.warnings.length).toBeGreaterThanOrEqual(5);
    });
  });
});
