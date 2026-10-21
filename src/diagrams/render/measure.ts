import type { ViewMeasurer } from '@/domain/commands/types';
import { layoutNode, layoutNote } from './nodeShapes';
import { PRINT_THEME } from './theme';

/**
 * Rendered bounds of a box view (stored size grown to the intrinsic minimum), injected into the
 * command engine so visual containment uses what the user actually sees. Reads only.
 */
export const measureView: ViewMeasurer = (doc, diagram, view) => {
  if (view.kind === 'note') {
    const layout = layoutNote(PRINT_THEME, view);
    return { x: view.x, y: view.y, width: layout.width, height: layout.height };
  }
  if (view.kind !== 'node') return null;
  const element = doc.modelElements[view.elementId];
  if (!element) return null;
  const hasChildren = Object.values(diagram.views).some((v) => (v.kind === 'node' || v.kind === 'note') && v.containerViewId === view.id);
  const layout = layoutNode({ doc, diagram, theme: PRINT_THEME, hasChildren }, view, element);
  return { x: view.x, y: view.y, width: layout.width, height: layout.height };
};
