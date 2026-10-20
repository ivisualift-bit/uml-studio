import type { ID } from '../schemas/common';

export type Severity = 'error' | 'warning' | 'info';

/** Every code has a localized message `problems.<code>` in each UI dictionary. */
export type ValidationCode =
  | 'nameRequired'
  | 'duplicateName'
  | 'invalidEndpoints'
  | 'invalidMultiplicity'
  | 'selfGeneralization'
  | 'inheritanceCycle'
  | 'duplicateGeneralization'
  | 'compositionCycle'
  | 'abstractOperationInConcreteClass'
  | 'duplicateAttributeName'
  | 'unnamedParameter'
  | 'actorAssociation'
  | 'useCaseWithoutActor'
  | 'includeCycle'
  | 'messageNegativeY'
  | 'messageAfterDestroy'
  | 'createAfterMessages'
  | 'selfCreateOrDestroy'
  | 'fragmentOperandOrder'
  | 'activationRange'
  | 'missingInitialNode'
  | 'missingFinalNode'
  | 'initialHasIncoming'
  | 'finalHasOutgoing'
  | 'decisionOutgoing'
  | 'decisionGuardMissing'
  | 'mergeIncoming'
  | 'forkOutgoing'
  | 'joinIncoming'
  | 'unconnectedActivityNode'
  | 'missingInitialState'
  | 'initialStateOutgoing'
  | 'initialTransitionTrigger'
  | 'multipleInitialStates'
  | 'unreachableState'
  | 'objectFlowWithoutObject'
  | 'linkClassifierMismatch';

export interface ValidationIssue {
  /** Deterministic: same problem → same id across runs (stable list keys, dedupe). */
  id: string;
  code: ValidationCode;
  severity: Severity;
  elementId?: ID;
  diagramId?: ID;
  params: Record<string, string | number>;
}
