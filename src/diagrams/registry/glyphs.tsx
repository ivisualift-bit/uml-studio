import type { ReactNode } from 'react';
import type { ElementKind } from '@/domain/schemas/elements';
import type { DiagramKind } from '@/domain/schemas/project';

/** Original 20×20 UML notation glyphs (stroke = currentColor). */
const G = {
  class: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1" />
      <path d="M3 7.5h14M3 12h14" />
    </>
  ),
  abstractClass: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1" strokeDasharray="2 1.5" />
      <path d="M3 7.5h14" />
      <path d="M8 5.5l2.5-1" />
    </>
  ),
  interface: (
    <>
      <rect x="3" y="5" width="14" height="12" rx="1" />
      <path d="M3 10h14" />
      <path d="M7 3.2h1.2M11.8 3.2H13" />
    </>
  ),
  enumeration: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1" />
      <path d="M3 7.5h14M6 10.5h7M6 13.5h5" />
    </>
  ),
  dataType: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <path d="M3 8.5h14M7 12.5h6" />
    </>
  ),
  signal: (
    <>
      <path d="M3 4h10l4 6-4 6H3z" />
    </>
  ),
  package: (
    <>
      <path d="M3 6.5V17h14V6.5H9.5L8.5 4H3z" />
      <path d="M3 6.5h6.5" />
    </>
  ),
  model: (
    <>
      <path d="M3 6.5V17h14V6.5H9.5L8.5 4H3z" />
      <path d="M10 9l3 5H7z" />
    </>
  ),
  association: <path d="M3 15L17 5" />,
  directedAssociation: (
    <>
      <path d="M3 15L17 5" />
      <path d="M12.5 5.3L17 5l-1.6 4.2" />
    </>
  ),
  aggregation: (
    <>
      <path d="M8 11.4L17 5" />
      <path d="M3 15l2-3.8 3 .2-2 3.8z" />
    </>
  ),
  composition: (
    <>
      <path d="M8 11.4L17 5" />
      <path d="M3 15l2-3.8 3 .2-2 3.8z" fill="currentColor" />
    </>
  ),
  generalization: (
    <>
      <path d="M3 17L12 8" />
      <path d="M12 4.5l4.5-1 -1 4.5z" />
    </>
  ),
  realization: (
    <>
      <path d="M3 17L12 8" strokeDasharray="2 1.6" />
      <path d="M12 4.5l4.5-1 -1 4.5z" />
    </>
  ),
  dependency: (
    <>
      <path d="M3 17L16 4" strokeDasharray="2 1.6" />
      <path d="M11.5 4.3L16 4l-.3 4.5" />
    </>
  ),
  extensionArrow: (
    <>
      <path d="M3 17L12 8" />
      <path d="M12 4.5l4.5-1 -1 4.5z" fill="currentColor" />
    </>
  ),
  note: (
    <>
      <path d="M4 3h9l3 3v11H4z" />
      <path d="M13 3v3h3M7 9h6M7 12h5" />
    </>
  ),
  noteLink: (
    <>
      <path d="M3 4h6v5H3z" />
      <path d="M9 9l8 8" strokeDasharray="1.6 1.4" />
    </>
  ),
  actor: (
    <>
      <circle cx="10" cy="4.5" r="2.3" />
      <path d="M10 6.8v6M5.5 9h9M10 12.8l-3.5 4.4M10 12.8l3.5 4.4" />
    </>
  ),
  useCase: <ellipse cx="10" cy="10" rx="7.5" ry="4.8" />,
  subject: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <ellipse cx="10" cy="11.5" rx="4.5" ry="2.6" />
      <path d="M6 5.5h8" />
    </>
  ),
  include: (
    <>
      <path d="M3 15L16 5" strokeDasharray="2 1.6" />
      <path d="M11.5 5.4L16 5l-1.2 4.3" />
      <text x="2" y="7" fontSize="5" stroke="none" fill="currentColor">
        inc
      </text>
    </>
  ),
  extend: (
    <>
      <path d="M3 15L16 5" strokeDasharray="2 1.6" />
      <path d="M11.5 5.4L16 5l-1.2 4.3" />
      <text x="2" y="7" fontSize="5" stroke="none" fill="currentColor">
        ext
      </text>
    </>
  ),
  lifeline: (
    <>
      <rect x="4" y="2.5" width="12" height="5" rx="0.8" />
      <path d="M10 7.5v10" strokeDasharray="1.8 1.6" />
    </>
  ),
  activation: (
    <>
      <path d="M10 2v16" strokeDasharray="1.8 1.6" />
      <rect x="7.8" y="5.5" width="4.4" height="9" fill="currentColor" fillOpacity="0.25" />
    </>
  ),
  syncMessage: (
    <>
      <path d="M3 10h11" />
      <path d="M13 7.3l4 2.7-4 2.7z" fill="currentColor" />
    </>
  ),
  asyncMessage: (
    <>
      <path d="M3 10h14" />
      <path d="M13 7l4 3-4 3" />
    </>
  ),
  replyMessage: (
    <>
      <path d="M17 10H3" strokeDasharray="2 1.6" />
      <path d="M7 7l-4 3 4 3" />
    </>
  ),
  selfMessage: (
    <>
      <path d="M5 2v16" strokeDasharray="1.8 1.6" />
      <path d="M5 6h9v7H7" />
      <path d="M9 11l-2.5 2L9 15" />
    </>
  ),
  createMessage: (
    <>
      <path d="M2 12h8" strokeDasharray="2 1.6" />
      <path d="M7 9.5l3 2.5-3 2.5" />
      <rect x="10.5" y="9" width="7" height="6" />
    </>
  ),
  destroyMessage: (
    <>
      <path d="M2 10h9" />
      <path d="M10 7.5l3 2.5-3 2.5z" fill="currentColor" />
      <path d="M14 7l4 6M18 7l-4 6" />
    </>
  ),
  foundMessage: (
    <>
      <circle cx="4" cy="10" r="2" fill="currentColor" />
      <path d="M6 10h11M13 7l4 3-4 3" />
    </>
  ),
  lostMessage: (
    <>
      <path d="M3 10h10M10 7l4 3-4 3" />
      <circle cx="16" cy="10" r="2" fill="currentColor" />
    </>
  ),
  fragment: (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7.5h6l1.4-1.6V3M2.5 11.5h15" />
    </>
  ),
  action: <rect x="2.5" y="5" width="15" height="10" rx="4" />,
  sendSignal: <path d="M2.5 5h11l4 5-4 5h-11z" />,
  acceptEvent: <path d="M2.5 5h15v10h-15l4-5z" />,
  timeEvent: <path d="M5 3h10L5 17h10z" />,
  objectNode: (
    <>
      <rect x="3" y="5" width="14" height="10" />
      <path d="M6 11.5h8" />
    </>
  ),
  swimlane: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <path d="M2.5 6.5h15M10 2.5v15" />
    </>
  ),
  initial: <circle cx="10" cy="10" r="5" fill="currentColor" />,
  final: (
    <>
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="3.5" fill="currentColor" />
    </>
  ),
  flowFinal: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M5.8 5.8l8.4 8.4M14.2 5.8l-8.4 8.4" />
    </>
  ),
  decision: <path d="M10 3l7 7-7 7-7-7z" />,
  bar: <rect x="2.5" y="8.5" width="15" height="3" fill="currentColor" />,
  flow: (
    <>
      <path d="M3 15c4-8 8-10 13-10" />
      <path d="M12.3 3.4L16 5l-3 2.8" />
    </>
  ),
  state: <rect x="2.5" y="5" width="15" height="10" rx="3.5" />,
  compositeState: (
    <>
      <rect x="2" y="2.5" width="16" height="15" rx="3" />
      <path d="M2 6.5h16" />
      <rect x="5" y="9.5" width="10" height="5" rx="1.8" />
    </>
  ),
  junction: <circle cx="10" cy="10" r="3.5" fill="currentColor" />,
  history: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M7.6 6.8v6.4M12.4 6.8v6.4M7.6 10h4.8" />
    </>
  ),
  entryPoint: <circle cx="10" cy="10" r="5" />,
  exitPoint: (
    <>
      <circle cx="10" cy="10" r="5" />
      <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" />
    </>
  ),
  terminate: <path d="M4 4l12 12M16 4L4 16" />,
  object: (
    <>
      <rect x="3" y="4" width="14" height="12" />
      <path d="M3 9h14M6 7h8" />
    </>
  ),
  component: (
    <>
      <rect x="5" y="3" width="12" height="14" />
      <rect x="3" y="6" width="4.5" height="2.6" />
      <rect x="3" y="11.4" width="4.5" height="2.6" />
    </>
  ),
  lollipop: (
    <>
      <circle cx="13" cy="10" r="3.5" />
      <path d="M3 10h6.5" />
    </>
  ),
  port: (
    <>
      <rect x="3" y="4" width="11" height="12" />
      <rect x="11.5" y="8" width="5" height="5" fill="currentColor" fillOpacity="0.3" />
    </>
  ),
  artifact: (
    <>
      <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
      <path d="M12 2.5V6h3.5" />
    </>
  ),
  assembly: (
    <>
      <path d="M2 10h5.5M14.5 10H18" />
      <circle cx="10" cy="10" r="2.5" />
      <path d="M13.3 6.3a4.6 4.6 0 0 1 0 7.4" />
    </>
  ),
  node: (
    <>
      <path d="M3 6.5l3-3h11v10.5l-3 3H3z" />
      <path d="M3 6.5h11v10.5M14 6.5l3-3" />
    </>
  ),
  composite: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <path d="M2.5 6.5h15" />
      <rect x="5" y="9" width="4" height="5" />
      <rect x="11" y="9" width="4" height="5" />
      <path d="M9 11.5h2" />
    </>
  ),
  part: (
    <>
      <rect x="3" y="5" width="14" height="10" />
      <path d="M6 10h8" />
    </>
  ),
  collaboration: <ellipse cx="10" cy="10" rx="7.5" ry="5" strokeDasharray="2 1.6" />,
  communication: (
    <>
      <rect x="2" y="3" width="6" height="4" />
      <rect x="12" y="13" width="6" height="4" />
      <path d="M8 6l4 7M10.5 7.5l1.5 2.5" />
    </>
  ),
  timing: <path d="M2 13h4V7h5v6h4V9h3" />,
  stereotype: (
    <>
      <rect x="3" y="5" width="14" height="12" />
      <path d="M6.5 3.3l-1.5 1 1.5 1M13.5 3.3l1.5 1-1.5 1" />
    </>
  ),
  informationItem: (
    <>
      <rect x="3" y="4" width="14" height="12" />
      <path d="M12 6.5h3v3z" fill="currentColor" />
    </>
  ),
  informationFlow: (
    <>
      <path d="M3 15L16 5" strokeDasharray="2 1.6" />
      <path d="M11.5 5.4L16 5l-1.2 4.3" />
      <path d="M4.5 6h3v3z" fill="currentColor" />
    </>
  ),
  sequence: (
    <>
      <rect x="2" y="2.5" width="6" height="3.5" />
      <rect x="12" y="2.5" width="6" height="3.5" />
      <path d="M5 6v11.5M15 6v11.5" strokeDasharray="1.6 1.4" />
      <path d="M5 10h9M12.5 8.6L14.5 10l-2 1.4" />
    </>
  ),
  activity: (
    <>
      <circle cx="10" cy="3.5" r="1.8" fill="currentColor" />
      <rect x="4" y="7" width="12" height="5" rx="2" />
      <path d="M10 5.3V7M10 12v2.5" />
      <circle cx="10" cy="16.5" r="1.8" />
    </>
  ),
  interaction: (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h5l1.2-1.4V3M6 12h8M12 10.5l2 1.5-2 1.5" />
    </>
  ),
  stateMachine: (
    <>
      <rect x="2" y="3" width="7" height="5" rx="2" />
      <rect x="11" y="12" width="7" height="5" rx="2" />
      <path d="M7 8l5 4" />
    </>
  ),
  relationship: <path d="M3 15L17 5" />,
  diagram: (
    <>
      <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
      <rect x="5" y="6" width="4" height="3" />
      <rect x="11" y="11" width="4" height="3" />
      <path d="M9 7.5h2v5h0" />
    </>
  ),
  metaclass: (
    <>
      <rect x="3" y="5" width="14" height="10" />
      <path d="M6 8.5h8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof G;

export function UmlGlyph({
  name,
  size = 18,
  className,
}: {
  name: GlyphName | string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {(G as Record<string, ReactNode>)[name] ?? G.diagram}
    </svg>
  );
}

const ELEMENT_GLYPHS: Partial<Record<ElementKind, GlyphName>> = {
  model: 'model',
  package: 'package',
  profile: 'package',
  class: 'class',
  interface: 'interface',
  enumeration: 'enumeration',
  dataType: 'dataType',
  primitiveType: 'dataType',
  signal: 'signal',
  instanceSpecification: 'object',
  component: 'component',
  artifact: 'artifact',
  port: 'port',
  part: 'part',
  collaboration: 'collaboration',
  node: 'node',
  stereotype: 'stereotype',
  metaclass: 'metaclass',
  informationItem: 'informationItem',
  actor: 'actor',
  useCase: 'useCase',
  subject: 'subject',
  activity: 'activity',
  action: 'action',
  controlNode: 'decision',
  objectNode: 'objectNode',
  activityPartition: 'swimlane',
  stateMachine: 'stateMachine',
  state: 'state',
  pseudostate: 'initial',
  finalState: 'final',
  interaction: 'interaction',
  lifeline: 'lifeline',
  message: 'asyncMessage',
  combinedFragment: 'fragment',
  activation: 'activation',
  association: 'association',
  generalization: 'generalization',
  realization: 'realization',
  dependency: 'dependency',
  include: 'include',
  extend: 'extend',
  packageImport: 'dependency',
  packageMerge: 'dependency',
  controlFlow: 'flow',
  objectFlow: 'flow',
  transition: 'flow',
  link: 'association',
  connector: 'association',
  deployment: 'dependency',
  manifestation: 'dependency',
  communicationPath: 'association',
  extension: 'extensionArrow',
  informationFlow: 'informationFlow',
};

export function glyphForElement(kind: ElementKind): GlyphName {
  return ELEMENT_GLYPHS[kind] ?? 'class';
}

const DIAGRAM_GLYPHS: Record<DiagramKind, GlyphName> = {
  class: 'class',
  useCase: 'useCase',
  sequence: 'sequence',
  activity: 'activity',
  stateMachine: 'stateMachine',
  package: 'package',
  object: 'object',
  component: 'component',
  deployment: 'node',
  compositeStructure: 'composite',
  communication: 'communication',
  timing: 'timing',
  interactionOverview: 'interaction',
  profile: 'stereotype',
  informationFlow: 'informationFlow',
};

export function glyphForDiagram(kind: DiagramKind): GlyphName {
  return DIAGRAM_GLYPHS[kind];
}
