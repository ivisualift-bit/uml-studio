import type { ID } from '@/domain/schemas/common';
import type { ProjectDocument } from '@/domain/schemas/project';
import { serializeProject } from '@/domain/serialization/projectFile';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { PRINT_THEME } from '@/diagrams/render/theme';

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'json';

export interface ImageExportOptions {
  background: 'white' | 'transparent';
  scale: 1 | 2 | 4;
  includeTitle: boolean;
}

export type PageSize = 'a4' | 'a3' | 'letter' | 'fit';

export interface PdfExportOptions {
  pageSize: PageSize;
  orientation: 'auto' | 'landscape' | 'portrait';
  includeTitle: boolean;
  pageNumbers: boolean;
}

export interface ExportResult {
  blob: Blob;
  extension: string;
  mime: string;
  width?: number;
  height?: number;
  notes: Array<'rasterFallback' | 'vector'>;
}

/** Browser canvas limits (conservative across Chrome/Safari/Firefox). */
export const MAX_CANVAS_SIDE = 16_384;
export const MAX_CANVAS_PIXELS = 100_000_000;

export class ExportTooLargeError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(`Image too large: ${width}×${height}`);
    this.name = 'ExportTooLargeError';
  }
}

export function exportSvg(
  doc: ProjectDocument,
  diagramId: ID,
  options: Pick<ImageExportOptions, 'background' | 'includeTitle'>,
): ExportResult {
  const diagram = doc.diagrams[diagramId]!;
  const { svg, width, height } = renderDiagramSvg(doc, diagramId, {
    theme: PRINT_THEME,
    background: options.background === 'white' ? '#ffffff' : null,
    heading: options.includeTitle ? diagram.name : undefined,
  });
  return {
    blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    extension: 'svg',
    mime: 'image/svg+xml',
    width,
    height,
    notes: ['vector'],
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The diagram could not be rasterized'));
    image.src = url;
  });
}

async function rasterize(svg: string, width: number, height: number, transparent: boolean): Promise<Blob> {
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS)
    throw new ExportTooLargeError(width, height);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    if (!transparent) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(
  doc: ProjectDocument,
  diagramId: ID,
  options: ImageExportOptions,
): Promise<ExportResult> {
  const diagram = doc.diagrams[diagramId]!;
  const { svg, width, height } = renderDiagramSvg(doc, diagramId, {
    theme: PRINT_THEME,
    background: options.background === 'white' ? '#ffffff' : null,
    heading: options.includeTitle ? diagram.name : undefined,
    scale: options.scale,
  });
  const blob = await rasterize(svg, width, height, options.background === 'transparent');
  return { blob, extension: 'png', mime: 'image/png', width, height, notes: [] };
}

/** Characters encodable by the PDF standard Helvetica font (WinAnsi / CP1252). */
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function isWinAnsiEncodable(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) continue;
    if (CP1252_EXTRA.has(ch)) continue;
    return false;
  }
  return true;
}

const PAGE_SIZES_PT: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
};

/** SVG user units are CSS px: 1 px = 0.75 pt. */
const PX_TO_PT = 0.75;

export async function exportPdf(
  doc: ProjectDocument,
  diagramId: ID,
  options: PdfExportOptions,
): Promise<ExportResult> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const diagram = doc.diagrams[diagramId]!;
  const rendered = renderDiagramSvg(doc, diagramId, { theme: PRINT_THEME, background: '#ffffff' });
  const contentW = rendered.width * PX_TO_PT;
  const contentH = rendered.height * PX_TO_PT;
  const margin = 28;
  const titleSpace = options.includeTitle ? 26 : 0;
  const footerSpace = options.pageNumbers ? 18 : 0;

  let pageW: number;
  let pageH: number;
  if (options.pageSize === 'fit') {
    pageW = contentW + margin * 2;
    pageH = contentH + margin * 2 + titleSpace + footerSpace;
  } else {
    const [w, h] = PAGE_SIZES_PT[options.pageSize];
    const landscape =
      options.orientation === 'landscape' || (options.orientation === 'auto' && contentW > contentH);
    [pageW, pageH] = landscape ? [h, w] : [w, h];
  }
  const pdf = new jsPDF({
    unit: 'pt',
    format: [pageW, pageH],
    orientation: pageW > pageH ? 'landscape' : 'portrait',
    compress: true,
  });
  pdf.setProperties({ title: diagram.name, subject: doc.name, creator: 'UML Studio' });

  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2 - titleSpace - footerSpace;
  const scale = Math.min(
    availW / contentW,
    availH / contentH,
    options.pageSize === 'fit' ? 1 : Number.POSITIVE_INFINITY,
  );
  const drawW = contentW * scale;
  const drawH = contentH * scale;
  const x = margin + (availW - drawW) / 2;
  const y = margin + titleSpace + (availH - drawH) / 2;

  const allText = [
    diagram.name,
    ...[...rendered.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? ''),
  ].join('');
  const vector = isWinAnsiEncodable(decodeEntities(allText));
  const titleText = vector ? diagram.name : asciiFallback(diagram.name);
  if (options.includeTitle) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(titleText, margin, margin + 14);
  }
  if (vector) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden';
    const svgElement = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml').documentElement;
    container.appendChild(document.importNode(svgElement, true));
    document.body.appendChild(container);
    try {
      await pdf.svg(container.firstElementChild!, { x, y, width: drawW, height: drawH });
    } finally {
      container.remove();
    }
  } else {
    // Raster fallback (reported to the user): standard PDF fonts cannot encode these characters.
    const rasterScale = Math.max(
      1,
      Math.min(4, Math.floor(Math.sqrt(MAX_CANVAS_PIXELS / (rendered.width * rendered.height)))),
    );
    const png = renderDiagramSvg(doc, diagramId, {
      theme: PRINT_THEME,
      background: '#ffffff',
      scale: rasterScale,
    });
    const blob = await rasterize(png.svg, png.width, png.height, false);
    const dataUrl = await blobToDataUrl(blob);
    pdf.addImage(dataUrl, 'PNG', x, y, drawW, drawH, undefined, 'FAST');
  }
  if (options.pageNumbers) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('1 / 1', pageW / 2, pageH - margin / 2, { align: 'center' });
  }
  const blob = pdf.output('blob');
  return { blob, extension: 'pdf', mime: 'application/pdf', notes: [vector ? 'vector' : 'rasterFallback'] };
}

export function exportJson(doc: ProjectDocument): ExportResult {
  return {
    blob: new Blob([serializeProject(doc)], { type: 'application/json' }),
    extension: 'json',
    mime: 'application/json',
    notes: [],
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function asciiFallback(text: string): string {
  return [...text].map((ch) => (isWinAnsiEncodable(ch) ? ch : '?')).join('');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}
