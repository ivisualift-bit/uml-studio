/** Imperative handle registered by the active canvas (graph or sequence) for viewport commands. */
export interface CanvasApi {
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  fit(): void;
  getZoom(): number;
}

export const canvasApi: { current: CanvasApi | null } = { current: null };
