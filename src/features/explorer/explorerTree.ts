import type { ID } from '@/domain/schemas/common';
import { isRelationship, type ModelElement } from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';

export interface TreeRow {
  id: ID;
  depth: number;
  kind: 'element' | 'diagram';
  element?: ModelElement;
  diagram?: UMLDiagram;
  hasChildren: boolean;
  expanded: boolean;
  /** Row matches the filter itself (vs. shown as an ancestor of a match). */
  match: boolean;
}

const KIND_ORDER: Record<string, number> = {
  package: 0,
  profile: 0,
  model: 0,
  interaction: 1,
  activity: 1,
  stateMachine: 1,
};

function sortChildren(a: ModelElement, b: ModelElement): number {
  const ra = isRelationship(a) ? 9 : (KIND_ORDER[a.kind] ?? 5);
  const rb = isRelationship(b) ? 9 : (KIND_ORDER[b.kind] ?? 5);
  return ra - rb || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

export interface TreeOptions {
  expanded: ReadonlySet<ID>;
  filter: string;
  showRelationships: boolean;
  /** Lowercase label of each element kind (for filtering by kind). */
  kindLabel: (el: ModelElement) => string;
}

/** Flatten the ownership tree (diagrams under their owners) into visible rows. */
export function buildTreeRows(doc: ProjectDocument, options: TreeOptions): TreeRow[] {
  const children = new Map<ID, ModelElement[]>();
  for (const el of Object.values(doc.modelElements)) {
    if (!el.ownerId) continue;
    if (!options.showRelationships && isRelationship(el)) continue;
    const list = children.get(el.ownerId);
    if (list) list.push(el);
    else children.set(el.ownerId, [el]);
  }
  for (const list of children.values()) list.sort(sortChildren);
  const diagramsByOwner = new Map<ID, UMLDiagram[]>();
  for (const d of Object.values(doc.diagrams)) {
    const list = diagramsByOwner.get(d.ownerId);
    if (list) list.push(d);
    else diagramsByOwner.set(d.ownerId, [d]);
  }
  for (const list of diagramsByOwner.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const query = options.filter.trim().toLowerCase();
  const matchesElement = (el: ModelElement) =>
    el.name.toLowerCase().includes(query) ||
    options.kindLabel(el).includes(query) ||
    el.stereotype.toLowerCase().includes(query) ||
    el.documentation.toLowerCase().includes(query);
  const matchesDiagram = (d: UMLDiagram) => d.name.toLowerCase().includes(query);

  // With a filter, keep matches and their ancestors (expanded automatically).
  const visible = new Set<ID>();
  if (query) {
    const markAncestors = (id: ID | null) => {
      let current = id;
      const guard = new Set<ID>();
      while (current && !guard.has(current)) {
        guard.add(current);
        visible.add(current);
        current = doc.modelElements[current]?.ownerId ?? null;
      }
    };
    for (const el of Object.values(doc.modelElements)) if (matchesElement(el) && (options.showRelationships || !isRelationship(el))) markAncestors(el.id);
    for (const d of Object.values(doc.diagrams)) {
      if (matchesDiagram(d)) {
        visible.add(d.id);
        markAncestors(d.ownerId);
      }
    }
  }

  const rows: TreeRow[] = [];
  const visit = (el: ModelElement, depth: number, seen: Set<ID>) => {
    if (seen.has(el.id)) return;
    seen.add(el.id);
    if (query && !visible.has(el.id)) return;
    const kids = children.get(el.id) ?? [];
    const diagrams = diagramsByOwner.get(el.id) ?? [];
    const hasChildren = kids.length + diagrams.length > 0;
    const expanded = query ? true : options.expanded.has(el.id);
    rows.push({ id: el.id, depth, kind: 'element', element: el, hasChildren, expanded, match: !query || matchesElement(el) });
    if (!expanded) return;
    for (const d of diagrams) {
      if (query && !visible.has(d.id)) continue;
      rows.push({ id: d.id, depth: depth + 1, kind: 'diagram', diagram: d, hasChildren: false, expanded: false, match: !query || matchesDiagram(d) });
    }
    for (const child of kids) visit(child, depth + 1, seen);
  };
  const root = doc.modelElements[doc.rootModelId];
  if (root) visit(root, 0, new Set());
  return rows;
}
