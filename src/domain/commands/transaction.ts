import type { ID } from '../schemas/common';
import type { ViewMeasurer } from './types';

/** Collects what a transaction touched so the engine can re-validate exactly those objects. */
export class Transaction {
  readonly elementIds = new Set<ID>();
  readonly diagramIds = new Set<ID>();
  /** `${diagramId}/${viewId}` */
  readonly viewKeys = new Set<string>();
  projectTouched = false;

  constructor(readonly measure: ViewMeasurer | undefined) {}

  touchElement(id: ID): void {
    this.elementIds.add(id);
  }

  touchDiagram(id: ID): void {
    this.diagramIds.add(id);
  }

  touchView(diagramId: ID, viewId: ID): void {
    this.diagramIds.add(diagramId);
    this.viewKeys.add(`${diagramId}/${viewId}`);
  }

  touchProject(): void {
    this.projectTouched = true;
  }
}
