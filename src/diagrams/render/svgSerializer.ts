import type { Primitive } from './primitives';
import { DIAGRAM_FONT_FAMILY, measureText } from './textMetrics';
import { round } from './geometry';

/** XML 1.0 forbids most C0 controls, U+FFFE/U+FFFF and unpaired surrogates. */
const INVALID_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeXmlText(value: string): string {
  return value.replace(INVALID_XML, '');
}

export function escapeXml(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Underlines are drawn as explicit lines (consistent across browsers, SVG viewers and svg2pdf). */
export function underlineFor(
  p: Extract<Primitive, { type: 'text' }>,
): Extract<Primitive, { type: 'line' }> | null {
  if (!p.underline || !p.text) return null;
  const width = measureText(p.text, p.fontSize, p.bold);
  const x1 = p.anchor === 'start' ? p.x : p.anchor === 'middle' ? p.x - width / 2 : p.x - width;
  const y = p.y + Math.max(1.5, p.fontSize * 0.14);
  return {
    type: 'line',
    x1,
    y1: y,
    x2: x1 + width,
    y2: y,
    stroke: p.fill,
    strokeWidth: Math.max(0.8, p.fontSize / 14),
  };
}

const num = (n: number) => String(round(n));
const pts = (points: Array<{ x: number; y: number }>) =>
  points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');

function strokeAttrs(p: { stroke: string; strokeWidth: number; dash?: string }): string {
  if (p.stroke === 'none' || p.strokeWidth === 0) return ' stroke="none"';
  return ` stroke="${escapeXml(p.stroke)}" stroke-width="${num(p.strokeWidth)}"${p.dash ? ` stroke-dasharray="${escapeXml(p.dash)}"` : ''}`;
}

export function serializePrimitives(primitives: Primitive[], indent = '  '): string {
  const out: string[] = [];
  const emit = (p: Primitive, pad: string) => {
    switch (p.type) {
      case 'rect':
        out.push(
          `${pad}<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(Math.max(0, p.width))}" height="${num(Math.max(0, p.height))}"${p.rx ? ` rx="${num(p.rx)}"` : ''} fill="${escapeXml(p.fill)}"${strokeAttrs(p)}/>`,
        );
        break;
      case 'ellipse':
        out.push(
          `${pad}<ellipse cx="${num(p.cx)}" cy="${num(p.cy)}" rx="${num(Math.max(0, p.rx))}" ry="${num(Math.max(0, p.ry))}" fill="${escapeXml(p.fill)}"${strokeAttrs(p)}/>`,
        );
        break;
      case 'line':
        out.push(
          `${pad}<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}"${strokeAttrs(p)} stroke-linecap="butt"/>`,
        );
        break;
      case 'polyline':
        out.push(
          `${pad}<polyline points="${pts(p.points)}" fill="${escapeXml(p.fill ?? 'none')}"${strokeAttrs(p)} stroke-linejoin="round"/>`,
        );
        break;
      case 'polygon':
        out.push(
          `${pad}<polygon points="${pts(p.points)}" fill="${escapeXml(p.fill)}"${strokeAttrs(p)} stroke-linejoin="miter"/>`,
        );
        break;
      case 'path':
        out.push(`${pad}<path d="${escapeXml(p.d)}" fill="${escapeXml(p.fill)}"${strokeAttrs(p)}/>`);
        break;
      case 'text': {
        if (!p.text) break;
        const anchor = p.anchor === 'start' ? '' : ` text-anchor="${p.anchor}"`;
        out.push(
          `${pad}<text x="${num(p.x)}" y="${num(p.y)}" font-size="${num(p.fontSize)}" fill="${escapeXml(p.fill)}"${anchor}${p.bold ? ' font-weight="bold"' : ''}${p.italic ? ' font-style="italic"' : ''} xml:space="preserve">${escapeXml(p.text)}</text>`,
        );
        const underline = underlineFor(p);
        if (underline) emit(underline, pad);
        break;
      }
      case 'group':
        out.push(`${pad}<g transform="translate(${num(p.dx)} ${num(p.dy)})">`);
        for (const child of p.children) emit(child, pad + indent);
        out.push(`${pad}</g>`);
        break;
      default:
        break;
    }
  };
  for (const p of primitives) emit(p, indent);
  return out.join('\n');
}

export interface SvgDocumentOptions {
  viewBox: { x: number; y: number; width: number; height: number };
  /** `null` = transparent. */
  background: string | null;
  title?: string;
  idPrefix: string;
  scale?: number;
}

export function svgDocument(primitives: Primitive[], options: SvgDocumentOptions): string {
  const { viewBox: vb } = options;
  const scale = options.scale ?? 1;
  const width = Math.max(1, Math.ceil(vb.width * scale));
  const height = Math.max(1, Math.ceil(vb.height * scale));
  const id = options.idPrefix.replace(/[^A-Za-z0-9_-]/g, '_');
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" id="${id}" width="${width}" height="${height}" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.width)} ${num(vb.height)}" font-family="${escapeXml(DIAGRAM_FONT_FAMILY)}">`,
  ];
  if (options.title) parts.push(`  <title>${escapeXml(options.title)}</title>`);
  parts.push('  <desc>Generated by UML Studio</desc>');
  if (options.background) {
    parts.push(
      `  <rect id="${id}-background" x="${num(vb.x)}" y="${num(vb.y)}" width="${num(vb.width)}" height="${num(vb.height)}" fill="${escapeXml(options.background)}"/>`,
    );
  }
  parts.push(`  <g id="${id}-content">`);
  parts.push(serializePrimitives(primitives, '  ').replace(/^/gm, '  '));
  parts.push('  </g>', '</svg>', '');
  return parts.join('\n');
}
