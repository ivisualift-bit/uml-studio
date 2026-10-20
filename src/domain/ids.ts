import type { ID } from './schemas/common';

/** Source of new identifiers. Command creators receive one so redo/replay never regenerates IDs. */
export interface IdGenerator {
  next(): ID;
}

export const uuidGenerator: IdGenerator = {
  next: () => crypto.randomUUID(),
};

/** Deterministic generator for tests and templates. */
export function sequentialIds(prefix = 'id'): IdGenerator {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
