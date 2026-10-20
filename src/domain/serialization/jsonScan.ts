/**
 * Linear pre-scan of untrusted JSON text, run BEFORE `JSON.parse`:
 * - detects duplicate object keys (JSON.parse silently keeps the last one, which could hide
 *   duplicate identifiers in `modelElements`/`views` records);
 * - bounds nesting depth (defence against pathological inputs).
 * It does not validate full JSON syntax — `JSON.parse` does that afterwards.
 */
export interface JsonScanResult {
  duplicateKeys: string[];
  maxDepthExceeded: boolean;
}

export function scanJson(text: string, maxDepth = 128, maxReported = 20): JsonScanResult {
  const duplicateKeys: string[] = [];
  // Stack of key sets for open objects; `null` marks an array level.
  const stack: Array<Set<string> | null> = [];
  let expectingKey = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text.charCodeAt(i);
    if (ch === 0x22 /* " */) {
      // Read string (handles escapes; content only decoded for keys).
      let j = i + 1;
      let hasEscape = false;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 0x5c /* \ */) {
          hasEscape = true;
          j += 2;
          continue;
        }
        if (c === 0x22) break;
        j += 1;
      }
      const top = stack[stack.length - 1];
      if (expectingKey && top) {
        const raw = text.slice(i + 1, j);
        let key = raw;
        if (hasEscape) {
          try {
            key = JSON.parse(`"${raw}"`) as string;
          } catch {
            key = raw;
          }
        }
        if (top.has(key)) {
          if (duplicateKeys.length < maxReported) duplicateKeys.push(key);
        } else top.add(key);
        expectingKey = false;
      }
      i = j + 1;
      continue;
    }
    if (ch === 0x7b /* { */) {
      stack.push(new Set());
      if (stack.length > maxDepth) return { duplicateKeys, maxDepthExceeded: true };
      expectingKey = true;
    } else if (ch === 0x5b /* [ */) {
      stack.push(null);
      if (stack.length > maxDepth) return { duplicateKeys, maxDepthExceeded: true };
      expectingKey = false;
    } else if (ch === 0x7d /* } */ || ch === 0x5d /* ] */) {
      stack.pop();
      expectingKey = false;
    } else if (ch === 0x2c /* , */) {
      expectingKey = stack[stack.length - 1] !== null && stack.length > 0;
    } else if (ch === 0x3a /* : */) {
      expectingKey = false;
    }
    i += 1;
  }
  return { duplicateKeys, maxDepthExceeded: false };
}
