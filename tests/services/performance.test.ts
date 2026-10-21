// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { executeCommands } from '@/domain/commands/engine';
import { parseProjectText, serializeProject } from '@/domain/serialization/projectFile';
import { validateProject } from '@/domain/validation/rules';
import { layoutGraphDiagram } from '@/diagrams/render/graphLayout';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { measureView } from '@/diagrams/render/measure';
import { PRINT_THEME } from '@/diagrams/render/theme';
import { ProjectBuilder } from '@/services/templates/builder';

/**
 * Performance smoke tests with generous ceilings (CI machines vary). Measured timings are printed and
 * recorded in docs/TEST_REPORT.md; the ceilings only catch pathological regressions.
 */
function bigProject(classes: number, edgesPerClass: number) {
  const b = new ProjectBuilder('Big', { idPrefix: 'big' });
  const d = b.diagram('class', 'Large');
  const views: string[] = [];
  for (let i = 0; i < classes; i += 1) {
    const n = b.node(d, 'class', `Class${i}`, (i % 10) * 220, Math.floor(i / 10) * 160, {
      width: 160,
      height: 80,
    });
    b.attribute(n.elementId, `- field${i}: String`);
    b.operation(n.elementId, `+ op${i}(arg: Integer): Boolean`);
    views.push(n.viewId);
  }
  for (let i = 0; i < classes; i += 1) {
    for (let k = 1; k <= edgesPerClass; k += 1) {
      const j = (i + k * 7) % classes;
      if (j !== i) b.connect(d, k % 2 ? 'association' : 'dependency', views[i]!, views[j]!);
    }
  }
  return { doc: b.build(), diagramId: d, firstView: views[0]! };
}

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
};

describe('performance', () => {
  it('100 classes / 200 edges: drag commit, layout and SVG export stay interactive', () => {
    const [{ doc, diagramId, firstView }, buildMs] = time(() => bigProject(100, 2));
    const diagram = doc.diagrams[diagramId]!;
    expect(Object.values(diagram.views).filter((v) => v.kind === 'edge').length).toBeGreaterThanOrEqual(190);
    const [, layoutMs] = time(() => layoutGraphDiagram(doc, diagram, PRINT_THEME));
    const [, layoutWarmMs] = time(() =>
      layoutGraphDiagram(doc, diagram, PRINT_THEME, { boxes: new Map([[firstView, { x: 15, y: 15 }]]) }),
    );
    const [outcome, moveMs] = time(() =>
      executeCommands(doc, [{ type: 'view/move', diagramId, viewIds: [firstView], dx: 20, dy: 10 }], {
        measure: measureView,
      }),
    );
    expect(outcome.ok).toBe(true);
    const [svg, svgMs] = time(() => renderDiagramSvg(doc, diagramId));
    expect(svg.svg.length).toBeGreaterThan(10_000);
    console.log(
      `[perf] 100 nodes/200 edges: build ${buildMs.toFixed(0)} ms, layout cold ${layoutMs.toFixed(1)} ms, layout per drag frame ${layoutWarmMs.toFixed(1)} ms, move commit ${moveMs.toFixed(1)} ms, SVG ${svgMs.toFixed(1)} ms`,
    );
    expect(layoutWarmMs).toBeLessThan(150);
    expect(moveMs).toBeLessThan(250);
  });

  it('500-element project: save, open (full validation pipeline) and model validation', () => {
    const { doc } = bigProject(250, 1); // 250 classes + ~250 relationships ≈ 500 model elements
    expect(Object.keys(doc.modelElements).length).toBeGreaterThanOrEqual(490);
    const [text, saveMs] = time(() => serializeProject(doc));
    const [parsed, openMs] = time(() => parseProjectText(text));
    expect(parsed.ok).toBe(true);
    const [, validateMs] = time(() => validateProject(doc));
    console.log(
      `[perf] ${Object.keys(doc.modelElements).length} elements, ${(text.length / 1024).toFixed(0)} KiB: save ${saveMs.toFixed(0)} ms, open+validate ${openMs.toFixed(0)} ms, rules ${validateMs.toFixed(0)} ms`,
    );
    expect(openMs).toBeLessThan(3000);
    expect(validateMs).toBeLessThan(2000);
  });
});
