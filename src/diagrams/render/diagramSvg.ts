import type { ID } from '@/domain/schemas/common';
import type { ProjectDocument } from '@/domain/schemas/project';
import { DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import { graphPrimitives, layoutGraphDiagram } from './graphLayout';
import type { Bounds, Primitive } from './primitives';
import { layoutSequence } from './sequenceLayout';
import { svgDocument } from './svgSerializer';
import { PRINT_THEME, type DiagramTheme } from './theme';
import { measureText } from './textMetrics';

export interface DiagramRenderOptions {
  theme?: DiagramTheme;
  /** Margin around the content bounds (diagram units). */
  margin?: number;
  /** `null` = transparent background. Defaults to the theme background. */
  background?: string | null;
  /** Optional heading drawn above the diagram. */
  heading?: string;
}

export interface RenderedDiagram {
  primitives: Primitive[];
  /** Content bounds including margin (the SVG viewBox). */
  viewBox: Bounds;
  isEmpty: boolean;
}

/** Vector scene for a diagram, computed by the same notation layer the canvas uses. */
export function renderDiagram(doc: ProjectDocument, diagramId: ID, options: DiagramRenderOptions = {}): RenderedDiagram {
  const diagram = doc.diagrams[diagramId];
  if (!diagram) throw new Error(`Diagram ${diagramId} not found`);
  const theme = options.theme ?? PRINT_THEME;
  const margin = options.margin ?? 24;
  const mode = DIAGRAM_KIND_INFO[diagram.kind].renderMode;
  let primitives: Primitive[] = [];
  let bounds: Bounds | null = null;
  if (mode === 'graph') {
    const layout = layoutGraphDiagram(doc, diagram, theme);
    primitives = graphPrimitives(layout);
    bounds = layout.bounds;
  } else if (mode === 'sequence') {
    const layout = layoutSequence(doc, diagram, theme);
    primitives = layout.primitives;
    bounds = layout.bounds;
  }
  const isEmpty = !bounds;
  let content = bounds ?? { x: 0, y: 0, width: 200, height: 100 };
  if (options.heading) {
    const size = 16;
    const headingY = content.y - 14;
    primitives = [
      { type: 'text', x: content.x, y: headingY, text: options.heading, fontSize: size, bold: true, anchor: 'start', fill: theme.text },
      ...primitives,
    ];
    const headingWidth = measureText(options.heading, size, true);
    content = {
      x: content.x,
      y: headingY - size,
      width: Math.max(content.width, headingWidth),
      height: content.height + size + 14,
    };
  }
  const viewBox = {
    x: Math.floor(content.x - margin),
    y: Math.floor(content.y - margin),
    width: Math.ceil(content.width + margin * 2),
    height: Math.ceil(content.height + margin * 2),
  };
  return { primitives, viewBox, isEmpty };
}

export interface SvgExportOptions extends DiagramRenderOptions {
  scale?: number;
}

export function renderDiagramSvg(doc: ProjectDocument, diagramId: ID, options: SvgExportOptions = {}): { svg: string; width: number; height: number } {
  const theme = options.theme ?? PRINT_THEME;
  const rendered = renderDiagram(doc, diagramId, options);
  const diagram = doc.diagrams[diagramId]!;
  const background = options.background === undefined ? theme.background : options.background;
  const svg = svgDocument(rendered.primitives, {
    viewBox: rendered.viewBox,
    background,
    title: diagram.name,
    idPrefix: `umls-${diagram.id}`,
    scale: options.scale,
  });
  const scale = options.scale ?? 1;
  return { svg, width: Math.ceil(rendered.viewBox.width * scale), height: Math.ceil(rendered.viewBox.height * scale) };
}
