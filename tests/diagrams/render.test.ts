// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { layoutGraphDiagram } from '@/diagrams/render/graphLayout';
import { edgeNotation, rayExit } from '@/diagrams/render/edges';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { layoutSequence } from '@/diagrams/render/sequenceLayout';
import { escapeXml } from '@/diagrams/render/svgSerializer';
import { measureText, wrapText } from '@/diagrams/render/textMetrics';
import { PRINT_THEME } from '@/diagrams/render/theme';
import { createLifelineCommands, createMessageCommands, createActivationCommands } from '@/domain/commands/creators';
import type { Relationship } from '@/domain/schemas/elements';
import { addNode, apply, connect, withDiagram } from '../helpers';

function parseSvg(svg: string): Document {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = parsed.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`SVG is not well-formed XML: ${error.textContent}`);
  return parsed;
}

function classDiagram() {
  const f = withDiagram('class', 'Domain «model» & <test>');
  const person = addNode(f, f.diagramId, { kind: 'class', name: 'Person' }, 0, 0, { width: 100, height: 40 });
  const student = addNode(f, f.diagramId, { kind: 'class', name: 'Étudiant' }, 0, 300, { width: 100, height: 40 });
  f.doc = apply(f.doc, [
    { type: 'member/add', elementId: person.elementId, collection: 'attributes', member: { id: 'a-name', name: 'name', type: 'String', visibility: 'private' } },
    { type: 'member/add', elementId: person.elementId, collection: 'operations', member: { id: 'o-greet', name: 'greet', returnType: 'void', isStatic: true } },
  ]);
  const gen = connect(f, f.diagramId, 'generalization', student.viewId, person.viewId);
  return { f, person, student, gen };
}

describe('text metrics', () => {
  it('measures accented letters like their base letters and wraps text', () => {
    expect(measureText('é', 13)).toBeCloseTo(measureText('e', 13));
    expect(measureText('W', 13)).toBeGreaterThan(measureText('i', 13));
    const lines = wrapText('Register for an advanced course', 90, 13);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measureText(line, 13)).toBeLessThanOrEqual(90 + 1e-6);
  });
});

describe('class node notation', () => {
  it('grows to fit compartments and keeps rows for inline editing', () => {
    const { f, person } = classDiagram();
    const layout = layoutGraphDiagram(f.doc, f.doc.diagrams[f.diagramId]!, PRINT_THEME);
    const node = layout.nodeById.get(person.viewId)!;
    expect(node.layout.height).toBeGreaterThan(40); // stored 40 < intrinsic
    expect(node.layout.rows.map((r) => r.collection)).toEqual(['attributes', 'operations']);
    const texts = node.layout.primitives.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p : null));
    expect(texts.map((t) => t?.text)).toContain('- name: String');
    const op = texts.find((t) => t?.text === '+ greet(): void');
    expect(op?.underline).toBe(true); // static → underlined
  });

  it('renders abstract class names in italics and interfaces with a keyword', () => {
    const f = withDiagram('class');
    const abs = addNode(f, f.diagramId, { kind: 'class', name: 'Shape' });
    f.doc = apply(f.doc, { type: 'element/update', elementId: abs.elementId, patch: { isAbstract: true } });
    const itf = addNode(f, f.diagramId, { kind: 'interface', name: 'Drawable' }, 300);
    const layout = layoutGraphDiagram(f.doc, f.doc.diagrams[f.diagramId]!, PRINT_THEME);
    const shapeName = layout.nodeById.get(abs.viewId)!.layout.primitives.find((p) => p.type === 'text' && p.text === 'Shape');
    expect(shapeName?.type === 'text' && shapeName.italic).toBe(true);
    const itfTexts = layout.nodeById.get(itf.viewId)!.layout.primitives.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''));
    expect(itfTexts).toContain('«interface»');
  });
});

describe('edge notation', () => {
  it('maps relationship kinds to UML markers and line styles', () => {
    const { f, gen } = classDiagram();
    const rel = f.doc.modelElements[gen.relationshipId] as Relationship;
    expect(edgeNotation(f.doc, rel)).toMatchObject({ dashed: false, targetMarker: 'hollowTriangle', sourceMarker: 'none' });
    const a = addNode(f, f.diagramId, { kind: 'class', name: 'Order' }, 400, 0);
    const b = addNode(f, f.diagramId, { kind: 'class', name: 'Line' }, 400, 300);
    const comp = connect(f, f.diagramId, 'composition', a.viewId, b.viewId);
    expect(edgeNotation(f.doc, f.doc.modelElements[comp.relationshipId] as Relationship)).toMatchObject({ sourceMarker: 'filledDiamond', targetMarker: 'none' });
    const i = addNode(f, f.diagramId, { kind: 'interface', name: 'I' }, 700, 0);
    const real = connect(f, f.diagramId, 'realization', a.viewId, i.viewId);
    expect(edgeNotation(f.doc, f.doc.modelElements[real.relationshipId] as Relationship)).toMatchObject({ dashed: true, targetMarker: 'hollowTriangle' });
    const dep = connect(f, f.diagramId, 'usage', b.viewId, i.viewId);
    expect(edgeNotation(f.doc, f.doc.modelElements[dep.relationshipId] as Relationship)).toMatchObject({ dashed: true, targetMarker: 'openArrow', labels: { stereotype: '«use»' } });
  });

  it('labels include/extend with keywords and points the arrow at the right use case', () => {
    const f = withDiagram('useCase');
    const enroll = addNode(f, f.diagramId, { kind: 'useCase', name: 'Enroll' });
    const auth = addNode(f, f.diagramId, { kind: 'useCase', name: 'Authenticate' }, 400, 0);
    const inc = connect(f, f.diagramId, 'include', enroll.viewId, auth.viewId);
    const layout = layoutGraphDiagram(f.doc, f.doc.diagrams[f.diagramId]!, PRINT_THEME);
    const edge = layout.edges.find((e) => e.view.id === inc.edgeViewId)!;
    expect(edge.layout.labels.map((l) => l.text)).toContain('«include»');
    // Arrow tip touches Authenticate (the included use case), on its ellipse outline.
    const tip = edge.layout.points[edge.layout.points.length - 1]!;
    const authNode = layout.nodeById.get(auth.viewId)!;
    expect(tip.x).toBeCloseTo(authNode.x, 0);
    expect(edge.layout.points[0]!.x).toBeGreaterThan(layout.nodeById.get(enroll.viewId)!.x + 100);
  });

  it('places multiplicities at both association ends without overlapping the endpoint', () => {
    const f = withDiagram('class');
    const s = addNode(f, f.diagramId, { kind: 'class', name: 'Student' }, 0, 0);
    const c = addNode(f, f.diagramId, { kind: 'class', name: 'Course' }, 400, 0);
    const assoc = connect(f, f.diagramId, 'association', s.viewId, c.viewId);
    const rel = f.doc.modelElements[assoc.relationshipId] as Extract<Relationship, { kind: 'association' }>;
    f.doc = apply(f.doc, {
      type: 'element/update',
      elementId: rel.id,
      patch: { sourceEnd: { ...rel.sourceEnd, multiplicity: '0..*' }, targetEnd: { ...rel.targetEnd, multiplicity: '1..*', name: 'courses' } },
    });
    const layout = layoutGraphDiagram(f.doc, f.doc.diagrams[f.diagramId]!, PRINT_THEME);
    const edge = layout.edges[0]!;
    const byKey = Object.fromEntries(edge.layout.labels.map((l) => [l.key, l]));
    expect(byKey.sourceMultiplicity?.text).toBe('0..*');
    expect(byKey.targetMultiplicity?.text).toBe('1..*');
    expect(byKey.targetRole?.text).toBe('courses');
    const [start, end] = [edge.layout.points[0]!, edge.layout.points[edge.layout.points.length - 1]!];
    expect(Math.abs(byKey.sourceMultiplicity!.x - start.x)).toBeGreaterThan(8);
    expect(Math.abs(byKey.targetMultiplicity!.x - end.x)).toBeGreaterThan(8);
  });

  it('docks rays on ellipse and diamond outlines', () => {
    const p = rayExit({ bounds: { x: 0, y: 0, width: 100, height: 50 }, outline: 'ellipse' }, { x: 50, y: 25 }, { x: 500, y: 25 });
    expect(p.x).toBeCloseTo(100, 0);
    const d = rayExit({ bounds: { x: 0, y: 0, width: 40, height: 40 }, outline: 'diamond' }, { x: 20, y: 20 }, { x: 20, y: -100 });
    expect(d.y).toBeCloseTo(0, 0);
  });
});

describe('SVG export', () => {
  it('produces well-formed SVG with escaped text, a viewBox covering all content and no markers', () => {
    const { f } = classDiagram();
    f.doc = apply(f.doc, { type: 'element/update', elementId: Object.values(f.doc.modelElements).find((e) => e.name === 'Person')!.id, patch: { name: 'Person <&> "quoted"' } });
    const { svg, width, height } = renderDiagramSvg(f.doc, f.diagramId, { background: '#ffffff' });
    const dom = parseSvg(svg);
    const root = dom.documentElement;
    expect(root.getAttribute('viewBox')).toMatch(/^-?\d+ -?\d+ \d+ \d+$/);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(300);
    expect(svg).not.toContain('<marker');
    const texts = [...dom.getElementsByTagName('text')].map((t) => t.textContent);
    expect(texts).toContain('Person <&> "quoted"');
    expect(texts).toContain('Étudiant');
    expect(dom.getElementsByTagName('title')[0]?.textContent).toBe('Domain «model» & <test>');
    // The hollow generalization triangle is an explicit polygon.
    expect(dom.getElementsByTagName('polygon').length).toBeGreaterThan(0);
    const [vx, vy, vw, vh] = root.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number];
    for (const r of [...dom.getElementsByTagName('rect')]) {
      if (r.id.endsWith('-background')) continue;
      const x = Number(r.getAttribute('x'));
      expect(x).toBeGreaterThanOrEqual(vx - 1);
      expect(x).toBeLessThanOrEqual(vx + vw);
      void vy;
      void vh;
    }
  });

  it('strips characters that are invalid in XML', () => {
    expect(escapeXml('a\u0001b￾c')).toBe('abc');
    expect(escapeXml('مرحبا')).toBe('مرحبا');
  });

  it('supports transparent backgrounds and empty diagrams', () => {
    const f = withDiagram('class');
    const { svg } = renderDiagramSvg(f.doc, f.diagramId, { background: null });
    parseSvg(svg);
    expect(svg).not.toContain('-background');
  });
});

describe('sequence layout', () => {
  it('anchors messages on activation edges and orders them by Y', () => {
    const f = withDiagram('sequence');
    const ll = (name: string, x: number) => {
      const c = createLifelineCommands(f.doc, { diagramId: f.diagramId, x, baseName: 'L', headStyle: 'object', name, ids: f.ids });
      if (!c.ok) throw new Error(c.reason);
      f.doc = apply(f.doc, c.commands);
      return c.viewId!;
    };
    const a = ll('Frontend', 100);
    const b = ll('API', 400);
    const act = createActivationCommands(f.doc, { diagramId: f.diagramId, lifelineViewId: b, startY: 120, endY: 220, ids: f.ids });
    if (!act.ok) throw new Error(act.reason);
    f.doc = apply(f.doc, act.commands);
    const m1 = createMessageCommands(f.doc, { diagramId: f.diagramId, sourceViewId: a, targetViewId: b, sort: 'synchronous', y: 120, name: 'login', ids: f.ids });
    if (!m1.ok) throw new Error(m1.reason);
    f.doc = apply(f.doc, m1.commands);
    const m2 = createMessageCommands(f.doc, { diagramId: f.diagramId, sourceViewId: b, targetViewId: a, sort: 'reply', y: 210, name: 'token', ids: f.ids });
    if (!m2.ok) throw new Error(m2.reason);
    f.doc = apply(f.doc, m2.commands);
    const layout = layoutSequence(f.doc, f.doc.diagrams[f.diagramId]!, PRINT_THEME);
    const call = layout.messages.get(m1.viewId!)!;
    expect(call.points[1]!.x).toBeCloseTo(400 - 6); // left edge of the activation bar
    expect(layout.orderedMessageIds).toEqual([m1.viewId, m2.viewId]);
    const reply = layout.messages.get(m2.viewId!)!;
    expect(reply.primitives.some((p) => p.type === 'polyline' && p.dash)).toBe(true);
    const { svg } = renderDiagramSvg(f.doc, f.diagramId);
    parseSvg(svg);
    expect(svg).toContain('stroke-dasharray'); // dashed lifelines and reply
  });
});
