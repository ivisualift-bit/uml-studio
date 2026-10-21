import { createContext, useContext } from 'react';
import type { ID, Point } from '@/domain/schemas/common';
import type { EdgeLabelKey } from '@/domain/schemas/views';
import type { EditTarget } from '@/stores/editorStore';
import type { DiagramTheme } from '@/diagrams/render/theme';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Callbacks shared by nodes/edges of one graph canvas (kept out of React Flow `data`). */
export interface GraphCanvasContextValue {
  diagramId: ID;
  theme: DiagramTheme;
  interactive: boolean;
  singleSelection: boolean;
  setTransientBox(viewId: ID, box: Box | null): void;
  commitBox(viewId: ID, box: Box): void;
  setTransientWaypoints(edgeId: ID, points: Point[] | null): void;
  commitWaypoints(edgeId: ID, points: Point[]): void;
  commitLabelOffset(edgeId: ID, key: EdgeLabelKey, offset: Point): void;
  reconnect(edgeId: ID, end: 'source' | 'target', nodeViewId: ID): void;
  startEdit(viewId: ID, target: EditTarget): void;
  addMember(elementId: ID, collection: 'attributes' | 'operations' | 'literals'): void;
  screenToFlow(point: Point): Point;
  setReconnectPreview(preview: { from: Point; to: Point } | null): void;
}

export const GraphCanvasContext = createContext<GraphCanvasContextValue | null>(null);

export function useGraphCanvas(): GraphCanvasContextValue {
  const value = useContext(GraphCanvasContext);
  if (!value) throw new Error('GraphCanvasContext missing');
  return value;
}
