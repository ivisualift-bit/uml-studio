/**
 * UML multiplicity: `*`, `n`, `n..m`, `n..*` (n ≤ m, non-negative integers). Empty = unspecified.
 */
export interface MultiplicityRange {
  lower: number;
  /** `null` = unbounded (`*`). */
  upper: number | null;
}

export type MultiplicityParse =
  | { ok: true; range: MultiplicityRange | null; normalized: string }
  | { ok: false; reason: 'syntax' | 'order' };

const NUMBER = /^\d{1,9}$/;

export function parseMultiplicity(input: string): MultiplicityParse {
  const text = input.trim();
  if (text === '') return { ok: true, range: null, normalized: '' };
  if (text === '*') return { ok: true, range: { lower: 0, upper: null }, normalized: '*' };
  if (NUMBER.test(text)) {
    const n = Number(text);
    return { ok: true, range: { lower: n, upper: n }, normalized: String(n) };
  }
  const match = /^(\d{1,9})\s*\.\.\s*(\d{1,9}|\*)$/.exec(text);
  if (!match) return { ok: false, reason: 'syntax' };
  const lower = Number(match[1]);
  if (match[2] === '*') return { ok: true, range: { lower, upper: null }, normalized: `${lower}..*` };
  const upper = Number(match[2]);
  if (upper < lower || upper === 0) return { ok: false, reason: 'order' };
  return { ok: true, range: { lower, upper }, normalized: `${lower}..${upper}` };
}

export function isValidMultiplicity(input: string): boolean {
  return parseMultiplicity(input).ok;
}

/** True when more than one value can be held (used by code generators to emit collections). */
export function isCollectionMultiplicity(input: string): boolean {
  const result = parseMultiplicity(input);
  if (!result.ok || !result.range) return false;
  return result.range.upper === null || result.range.upper > 1;
}

/** Quick-pick values offered by the inspector and the inline editor. */
export const COMMON_MULTIPLICITIES = ['1', '0..1', '*', '0..*', '1..*'] as const;
