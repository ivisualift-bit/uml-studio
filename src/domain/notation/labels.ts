/**
 * Behavioural edge labels.
 *   transition:   trigger [guard] / effect   (each part optional)
 *   control flow: [guard]
 * Guards are free text: no expression language is interpreted (spec §12).
 */

export interface TransitionLabel {
  trigger: string;
  guard: string;
  effect: string;
}

export function formatTransitionLabel(t: TransitionLabel): string {
  const parts: string[] = [];
  if (t.trigger.trim()) parts.push(t.trigger.trim());
  if (t.guard.trim()) parts.push(`[${t.guard.trim()}]`);
  let text = parts.join(' ');
  if (t.effect.trim()) text += `${text ? ' ' : ''}/ ${t.effect.trim()}`;
  return text;
}

export function parseTransitionLabel(input: string): TransitionLabel {
  let text = input.trim();
  let guard = '';
  let effect = '';
  // Guard = first top-level [...] block.
  const open = text.indexOf('[');
  if (open >= 0) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '[') depth += 1;
      else if (text[i] === ']') {
        depth -= 1;
        if (depth === 0) {
          guard = text.slice(open + 1, i).trim();
          text = `${text.slice(0, open)} ${text.slice(i + 1)}`;
          break;
        }
      }
    }
  }
  const slash = text.indexOf('/');
  if (slash >= 0) {
    effect = text.slice(slash + 1).trim();
    text = text.slice(0, slash);
  }
  return { trigger: text.replace(/\s+/g, ' ').trim(), guard, effect };
}

export function formatGuard(guard: string): string {
  return guard.trim() ? `[${guard.trim()}]` : '';
}

/** Accepts `cond` or `[cond]`. */
export function parseGuard(input: string): string {
  const text = input.trim();
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1).trim();
  return text;
}

/** Reply messages carry their return value in `name`; other messages render `name(args)`. */
export function formatMessageLabel(name: string, args: string, sort: string): string {
  if (sort === 'reply') return name || args;
  if (sort === 'create' && !name) return '«create»';
  if (sort === 'destroy' && !name) return '«destroy»';
  if (!name) return args ? `(${args})` : '';
  return `${name}(${args})`;
}

/** `name(args)` → parts; plain text becomes the name. */
export function parseMessageLabel(input: string): { name: string; arguments: string } {
  const text = input.trim();
  const open = text.indexOf('(');
  if (open > 0 && text.endsWith(')')) {
    return { name: text.slice(0, open).trim(), arguments: text.slice(open + 1, -1).trim() };
  }
  return { name: text, arguments: '' };
}
