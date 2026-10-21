import type { Visibility } from '../schemas/common';
import type { Attribute, Operation, Parameter, ParameterDirection } from '../schemas/members';
import { parseMultiplicity } from './multiplicity';

/**
 * Textual UML notation for features, used for rendering and for inline editing:
 *   attribute:  [visibility] [/]name [: Type] [[multiplicity]] [= default] [{readOnly, ordered, …}]
 *   operation:  [visibility] name(param, …) [: ReturnType] [{query}]
 *   parameter:  [in|out|inout|return] name [: Type] [[multiplicity]] [= default]
 * `static` may be written as a leading keyword when typing (it renders as underline).
 */

export const VISIBILITY_SYMBOL: Record<Visibility, string> = {
  public: '+',
  private: '-',
  protected: '#',
  package: '~',
};

const SYMBOL_VISIBILITY: Record<string, Visibility> = {
  '+': 'public',
  '-': 'private',
  '#': 'protected',
  '~': 'package',
};

export interface FormatOptions {
  showVisibility: boolean;
  showTypes: boolean;
}

const DEFAULT_FORMAT: FormatOptions = { showVisibility: true, showTypes: true };

export function formatAttribute(a: Attribute, options: FormatOptions = DEFAULT_FORMAT): string {
  let text = options.showVisibility ? `${VISIBILITY_SYMBOL[a.visibility]} ` : '';
  text += `${a.isDerived ? '/' : ''}${a.name}`;
  if (options.showTypes && a.type) text += `: ${a.type}`;
  if (a.multiplicity) text += ` [${a.multiplicity}]`;
  if (a.defaultValue) text += ` = ${a.defaultValue}`;
  const props: string[] = [];
  if (a.isReadOnly) props.push('readOnly');
  if (a.isOrdered) props.push('ordered');
  if (!a.isUnique) props.push('nonunique');
  if (props.length) text += ` {${props.join(', ')}}`;
  return text;
}

export function formatParameter(p: Parameter, options: FormatOptions = DEFAULT_FORMAT): string {
  let text = p.direction !== 'in' ? `${p.direction} ` : '';
  text += p.name;
  if (options.showTypes && p.type) text += `: ${p.type}`;
  if (p.multiplicity) text += ` [${p.multiplicity}]`;
  if (p.defaultValue) text += ` = ${p.defaultValue}`;
  return text;
}

export function formatOperation(
  o: Operation,
  options: FormatOptions & { showSignature: boolean } = { ...DEFAULT_FORMAT, showSignature: true },
): string {
  let text = options.showVisibility ? `${VISIBILITY_SYMBOL[o.visibility]} ` : '';
  const params = o.parameters.filter((p) => p.direction !== 'return');
  const signature = options.showSignature
    ? params.map((p) => formatParameter(p, options)).join(', ')
    : params.length
      ? '…'
      : '';
  text += `${o.name}(${signature})`;
  if (options.showTypes && o.returnType) text += `: ${o.returnType}`;
  if (o.isQuery) text += ' {query}';
  return text;
}

// -------------------------------------------------------------------------------------------------
// Parsing (tolerant, used by inline editors). Unparseable input returns null.
// -------------------------------------------------------------------------------------------------

/** Split on `sep` at bracket depth 0 (handles generics like `Map<K, V>` and nested parens). */
export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

interface Head {
  visibility?: Visibility;
  isStatic: boolean;
  rest: string;
}

function parseHead(text: string): Head {
  let rest = text.trim();
  let visibility: Visibility | undefined;
  let isStatic = false;
  for (let guard = 0; guard < 3; guard += 1) {
    const sym = SYMBOL_VISIBILITY[rest[0] ?? ''];
    if (sym && !visibility) {
      visibility = sym;
      rest = rest.slice(1).trim();
      continue;
    }
    const kw = /^(public|private|protected|package|static)\s+/.exec(rest);
    if (kw) {
      if (kw[1] === 'static') isStatic = true;
      else visibility = kw[1] as Visibility;
      rest = rest.slice(kw[0].length).trim();
      continue;
    }
    break;
  }
  return { visibility, isStatic, rest };
}

/** Extracts a trailing `{...}` property block. */
function takeProperties(text: string): { text: string; props: string[] } {
  const match = /\{([^{}]*)\}\s*$/.exec(text);
  if (!match) return { text, props: [] };
  return {
    text: text.slice(0, match.index).trim(),
    props: match[1]!
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

/** `name: Type [mult] = default` → parts (shared by attributes and parameters). */
function parseTypedPart(
  text: string,
): { name: string; type: string; multiplicity: string; defaultValue: string } | null {
  let rest = text.trim();
  let defaultValue = '';
  const eq = splitTopLevel(rest, '=');
  if (eq.length > 1) {
    rest = eq[0]!.trim();
    defaultValue = eq.slice(1).join('=').trim();
  }
  let multiplicity = '';
  const mult = /\[([^\]]*)\]\s*$/.exec(rest);
  if (mult) {
    multiplicity = mult[1]!.trim();
    rest = rest.slice(0, mult.index).trim();
    if (!parseMultiplicity(multiplicity).ok) return null;
  }
  const colon = splitTopLevel(rest, ':');
  const name = colon[0]!.trim();
  const type = colon.length > 1 ? colon.slice(1).join(':').trim() : '';
  if (!name || /\s/.test(name)) return null;
  return { name, type, multiplicity, defaultValue };
}

export type AttributeTextPatch = Pick<
  Attribute,
  | 'name'
  | 'type'
  | 'multiplicity'
  | 'defaultValue'
  | 'isDerived'
  | 'isReadOnly'
  | 'isOrdered'
  | 'isUnique'
  | 'isStatic'
> & { visibility?: Visibility };

export function parseAttributeText(input: string): AttributeTextPatch | null {
  const head = parseHead(input);
  const { text, props } = takeProperties(head.rest);
  let body = text;
  let isDerived = false;
  if (body.startsWith('/')) {
    isDerived = true;
    body = body.slice(1).trim();
  }
  const typed = parseTypedPart(body);
  if (!typed) return null;
  return {
    ...typed,
    visibility: head.visibility,
    isStatic: head.isStatic,
    isDerived,
    isReadOnly: props.includes('readOnly'),
    isOrdered: props.includes('ordered'),
    isUnique: !props.includes('nonunique'),
  };
}

const DIRECTIONS: readonly ParameterDirection[] = ['in', 'out', 'inout', 'return'];

export type ParameterTextPatch = Omit<Parameter, 'id' | 'typeElementId'>;

export function parseParameterText(input: string): ParameterTextPatch | null {
  let rest = input.trim();
  let direction: ParameterDirection = 'in';
  const dir = /^(in|out|inout|return)\s+/.exec(rest);
  if (dir && DIRECTIONS.includes(dir[1] as ParameterDirection)) {
    direction = dir[1] as ParameterDirection;
    rest = rest.slice(dir[0].length);
  }
  const typed = parseTypedPart(rest);
  if (!typed) return null;
  return { ...typed, direction };
}

export interface OperationTextPatch {
  name: string;
  visibility?: Visibility;
  isStatic: boolean;
  returnType: string;
  isQuery: boolean;
  parameters: ParameterTextPatch[];
}

export function parseOperationText(input: string): OperationTextPatch | null {
  const head = parseHead(input);
  const { text, props } = takeProperties(head.rest);
  const open = text.indexOf('(');
  let name: string;
  let paramText = '';
  let after = '';
  if (open < 0) {
    const colon = splitTopLevel(text, ':');
    name = colon[0]!.trim();
    after = colon.length > 1 ? `:${colon.slice(1).join(':')}` : '';
  } else {
    name = text.slice(0, open).trim();
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) return null;
    paramText = text.slice(open + 1, close);
    after = text.slice(close + 1).trim();
  }
  if (!name || /\s/.test(name)) return null;
  let returnType = '';
  if (after) {
    if (!after.startsWith(':')) return null;
    returnType = after.slice(1).trim();
  }
  const parameters: ParameterTextPatch[] = [];
  if (paramText.trim()) {
    for (const part of splitTopLevel(paramText, ',')) {
      const parsed = parseParameterText(part);
      if (!parsed) return null;
      parameters.push(parsed);
    }
  }
  return {
    name,
    visibility: head.visibility,
    isStatic: head.isStatic,
    returnType,
    isQuery: props.includes('query'),
    parameters,
  };
}
