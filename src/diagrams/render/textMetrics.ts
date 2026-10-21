/**
 * Deterministic text measurement from Helvetica AFM widths (Arial and Liberation Sans are
 * metric-compatible). Diagram text is always rendered with DIAGRAM_FONT_FAMILY, so node sizing is
 * identical in the canvas, in SVG/PNG export and in PDF (whose standard font is Helvetica).
 */
export const DIAGRAM_FONT_FAMILY = "Helvetica, Arial, 'Liberation Sans', sans-serif";

// Widths (1/1000 em) for ASCII 32..126.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function charWidth(code: number, bold: boolean): number {
  const table = bold ? BOLD : REGULAR;
  if (code >= 32 && code <= 126) return table[code - 32]!;
  if (code === 0x2026) return 1000; // …
  if (code === 0xab || code === 0xbb) return 556; // « »
  if (code >= 0xc0 && code <= 0x24f) {
    // Accented Latin letters measure like their base letter (é → e, Ç → C).
    const base = String.fromCodePoint(code).normalize('NFD').codePointAt(0)!;
    if (base >= 32 && base <= 126) return table[base - 32]!;
    return bold ? 667 : 611; // æ, ø, ß…
  }
  if (code >= 0x0600 && code <= 0x06ff) return 500; // Arabic
  if (code >= 0x0370 && code <= 0x04ff) return 600; // Greek / Cyrillic
  if (code >= 0x2e80) return 1000; // CJK and wide symbols
  return 600;
}

export function measureText(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch.codePointAt(0)!, bold);
  return (units * fontSize) / 1000;
}

/** Greedy word wrap; words longer than the width are hard-broken. */
export function wrapText(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, fontSize, bold) <= maxWidth || !line) {
        if (!line && measureText(word, fontSize, bold) > maxWidth) {
          // Hard break a long word.
          let chunk = '';
          for (const ch of word) {
            if (measureText(chunk + ch, fontSize, bold) > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export const LINE_HEIGHT = 1.3;
