import type { MessageKey } from '@/i18n';
import type { NodeSpec, RelationshipPreset } from '@/domain/commands/creators';
import type { ElementKind, FragmentOperator, NodeElementKind } from '@/domain/schemas/elements';
import type { MessageSort } from '@/domain/schemas/members';
import { DIAGRAM_KINDS, type DiagramKind } from '@/domain/schemas/project';
import { DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import type { GlyphName } from './glyphs';

export interface Size {
  width: number;
  height: number;
}

interface ToolBase {
  id: string;
  labelKey: MessageKey;
  labelParams?: Record<string, string>;
  glyph: GlyphName;
}

export type ToolDef =
  | (ToolBase & {
      type: 'node';
      spec: Omit<NodeSpec, 'baseName'>;
      size: Size;
      /** Extra element fields set in the same transaction (e.g. isAbstract). */
      init?: Record<string, unknown>;
      variant?: 'alternate';
    })
  | (ToolBase & { type: 'relationship'; preset: RelationshipPreset })
  | (ToolBase & { type: 'note' })
  | (ToolBase & { type: 'noteLink' })
  | (ToolBase & { type: 'lifeline'; headStyle: 'object' | 'actor' })
  | (ToolBase & { type: 'message'; sort: MessageSort; mode: 'between' | 'self' | 'found' | 'lost' })
  | (ToolBase & { type: 'activation' })
  | (ToolBase & { type: 'fragment'; operator: FragmentOperator });

export interface ToolGroup {
  titleKey: MessageKey;
  tools: ToolDef[];
}

export type DiagramStatus = 'complete' | 'partial' | 'planned';

export interface DiagramCatalogEntry {
  kind: DiagramKind;
  category: 'structural' | 'behavioral' | 'interaction';
  status: DiagramStatus;
  glyph: GlyphName;
  groups: ToolGroup[];
  supportsCodegen: boolean;
}

export const DEFAULT_SIZES: Partial<Record<ElementKind, Size>> = {
  class: { width: 160, height: 90 },
  interface: { width: 160, height: 70 },
  enumeration: { width: 150, height: 80 },
  dataType: { width: 150, height: 70 },
  primitiveType: { width: 140, height: 50 },
  signal: { width: 150, height: 70 },
  package: { width: 220, height: 150 },
  profile: { width: 220, height: 150 },
  instanceSpecification: { width: 160, height: 60 },
  component: { width: 170, height: 70 },
  artifact: { width: 150, height: 60 },
  port: { width: 16, height: 16 },
  part: { width: 140, height: 50 },
  collaboration: { width: 200, height: 110 },
  node: { width: 180, height: 110 },
  stereotype: { width: 160, height: 70 },
  metaclass: { width: 140, height: 50 },
  informationItem: { width: 150, height: 50 },
  actor: { width: 50, height: 90 },
  useCase: { width: 150, height: 64 },
  subject: { width: 320, height: 380 },
  action: { width: 130, height: 48 },
  objectNode: { width: 120, height: 44 },
  activityPartition: { width: 240, height: 480 },
  state: { width: 130, height: 56 },
  finalState: { width: 26, height: 26 },
  lifeline: { width: 120, height: 44 },
};

export function defaultSizeFor(kind: ElementKind, subKind?: string): Size {
  if (kind === 'controlNode') {
    if (subKind === 'fork' || subKind === 'join') return { width: 120, height: 8 };
    if (subKind === 'decision' || subKind === 'merge') return { width: 36, height: 36 };
    return { width: 24, height: 24 };
  }
  if (kind === 'pseudostate') {
    if (subKind === 'fork' || subKind === 'join') return { width: 100, height: 8 };
    if (subKind === 'choice') return { width: 30, height: 30 };
    if (subKind === 'junction') return { width: 14, height: 14 };
    return { width: 22, height: 22 };
  }
  return DEFAULT_SIZES[kind] ?? { width: 140, height: 60 };
}

const node = (
  id: string,
  labelKey: MessageKey,
  glyph: GlyphName,
  kind: NodeElementKind,
  extra: { subKind?: string; init?: Record<string, unknown>; variant?: 'alternate'; size?: Size; labelParams?: Record<string, string> } = {},
): ToolDef => ({
  id,
  type: 'node',
  labelKey,
  labelParams: extra.labelParams,
  glyph,
  spec: { kind, subKind: extra.subKind },
  size: extra.size ?? defaultSizeFor(kind, extra.subKind),
  init: extra.init,
  variant: extra.variant,
});

const rel = (id: string, labelKey: MessageKey, glyph: GlyphName, preset: RelationshipPreset): ToolDef => ({ id, type: 'relationship', labelKey, glyph, preset });

const annotations: ToolGroup = {
  titleKey: 'toolbox.groups.annotations',
  tools: [
    { id: 'note', type: 'note', labelKey: 'toolbox.note', glyph: 'note' },
    { id: 'noteLink', type: 'noteLink', labelKey: 'toolbox.noteLink', glyph: 'noteLink' },
  ],
};

const fragment = (operator: FragmentOperator): ToolDef => ({
  id: `fragment.${operator}`,
  type: 'fragment',
  operator,
  labelKey: 'toolbox.fragment',
  labelParams: { operator },
  glyph: 'fragment',
});

export const DIAGRAM_CATALOG: Record<DiagramKind, DiagramCatalogEntry> = {
  class: {
    kind: 'class',
    category: 'structural',
    status: 'complete',
    glyph: 'class',
    supportsCodegen: true,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('class.class', 'elementKind.class', 'class', 'class'),
          node('class.abstract', 'toolbox.abstractClass', 'abstractClass', 'class', { init: { isAbstract: true } }),
          node('class.interface', 'elementKind.interface', 'interface', 'interface'),
          node('class.enumeration', 'elementKind.enumeration', 'enumeration', 'enumeration'),
          node('class.dataType', 'elementKind.dataType', 'dataType', 'dataType'),
          node('class.primitiveType', 'elementKind.primitiveType', 'dataType', 'primitiveType'),
          node('class.signal', 'elementKind.signal', 'signal', 'signal'),
          node('class.package', 'elementKind.package', 'package', 'package'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('class.association', 'elementKind.association', 'association', 'association'),
          rel('class.directedAssociation', 'toolbox.directedAssociation', 'directedAssociation', 'directedAssociation'),
          rel('class.aggregation', 'toolbox.aggregation', 'aggregation', 'aggregation'),
          rel('class.composition', 'toolbox.composition', 'composition', 'composition'),
          rel('class.generalization', 'elementKind.generalization', 'generalization', 'generalization'),
          rel('class.realization', 'elementKind.realization', 'realization', 'realization'),
          rel('class.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
          rel('class.usage', 'toolbox.usage', 'dependency', 'usage'),
        ],
      },
      annotations,
    ],
  },
  useCase: {
    kind: 'useCase',
    category: 'behavioral',
    status: 'complete',
    glyph: 'useCase',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('uc.actor', 'elementKind.actor', 'actor', 'actor'),
          node('uc.useCase', 'elementKind.useCase', 'useCase', 'useCase'),
          node('uc.subject', 'elementKind.subject', 'subject', 'subject'),
          node('uc.package', 'elementKind.package', 'package', 'package'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('uc.association', 'elementKind.association', 'association', 'association'),
          rel('uc.include', 'elementKind.include', 'include', 'include'),
          rel('uc.extend', 'elementKind.extend', 'extend', 'extend'),
          rel('uc.generalization', 'elementKind.generalization', 'generalization', 'generalization'),
          rel('uc.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
        ],
      },
      annotations,
    ],
  },
  sequence: {
    kind: 'sequence',
    category: 'interaction',
    status: 'complete',
    glyph: 'sequence',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.lifelines',
        tools: [
          { id: 'seq.lifeline', type: 'lifeline', headStyle: 'object', labelKey: 'toolbox.lifeline', glyph: 'lifeline' },
          { id: 'seq.actorLifeline', type: 'lifeline', headStyle: 'actor', labelKey: 'toolbox.actorLifeline', glyph: 'actor' },
          { id: 'seq.activation', type: 'activation', labelKey: 'toolbox.activation', glyph: 'activation' },
        ],
      },
      {
        titleKey: 'toolbox.groups.messages',
        tools: [
          { id: 'seq.sync', type: 'message', sort: 'synchronous', mode: 'between', labelKey: 'toolbox.syncMessage', glyph: 'syncMessage' },
          { id: 'seq.async', type: 'message', sort: 'asynchronous', mode: 'between', labelKey: 'toolbox.asyncMessage', glyph: 'asyncMessage' },
          { id: 'seq.reply', type: 'message', sort: 'reply', mode: 'between', labelKey: 'toolbox.replyMessage', glyph: 'replyMessage' },
          { id: 'seq.self', type: 'message', sort: 'synchronous', mode: 'self', labelKey: 'toolbox.selfMessage', glyph: 'selfMessage' },
          { id: 'seq.create', type: 'message', sort: 'create', mode: 'between', labelKey: 'toolbox.createMessage', glyph: 'createMessage' },
          { id: 'seq.destroy', type: 'message', sort: 'destroy', mode: 'between', labelKey: 'toolbox.destroyMessage', glyph: 'destroyMessage' },
          { id: 'seq.found', type: 'message', sort: 'asynchronous', mode: 'found', labelKey: 'toolbox.foundMessage', glyph: 'foundMessage' },
          { id: 'seq.lost', type: 'message', sort: 'asynchronous', mode: 'lost', labelKey: 'toolbox.lostMessage', glyph: 'lostMessage' },
        ],
      },
      {
        titleKey: 'toolbox.groups.fragments',
        tools: (['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'ref'] as FragmentOperator[]).map(fragment),
      },
      { titleKey: 'toolbox.groups.annotations', tools: [{ id: 'note', type: 'note', labelKey: 'toolbox.note', glyph: 'note' }] },
    ],
  },
  activity: {
    kind: 'activity',
    category: 'behavioral',
    status: 'complete',
    glyph: 'activity',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('act.action', 'elementKind.action', 'action', 'action'),
          node('act.callBehavior', 'toolbox.callBehavior', 'action', 'action', { subKind: 'callBehavior' }),
          node('act.sendSignal', 'toolbox.sendSignal', 'sendSignal', 'action', { subKind: 'sendSignal' }),
          node('act.acceptEvent', 'toolbox.acceptEvent', 'acceptEvent', 'action', { subKind: 'acceptEvent' }),
          node('act.acceptTimeEvent', 'toolbox.acceptTimeEvent', 'timeEvent', 'action', { subKind: 'acceptTimeEvent', size: { width: 60, height: 60 } }),
          node('act.objectNode', 'elementKind.objectNode', 'objectNode', 'objectNode'),
          node('act.partition', 'elementKind.activityPartition', 'swimlane', 'activityPartition'),
        ],
      },
      {
        titleKey: 'toolbox.groups.control',
        tools: [
          node('act.initial', 'toolbox.initialNode', 'initial', 'controlNode', { subKind: 'initial' }),
          node('act.final', 'toolbox.finalNode', 'final', 'controlNode', { subKind: 'activityFinal' }),
          node('act.flowFinal', 'toolbox.flowFinal', 'flowFinal', 'controlNode', { subKind: 'flowFinal' }),
          node('act.decision', 'toolbox.decision', 'decision', 'controlNode', { subKind: 'decision' }),
          node('act.merge', 'toolbox.merge', 'decision', 'controlNode', { subKind: 'merge' }),
          node('act.fork', 'toolbox.fork', 'bar', 'controlNode', { subKind: 'fork' }),
          node('act.join', 'toolbox.join', 'bar', 'controlNode', { subKind: 'join' }),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('act.controlFlow', 'elementKind.controlFlow', 'flow', 'controlFlow'),
          rel('act.objectFlow', 'elementKind.objectFlow', 'flow', 'objectFlow'),
        ],
      },
      annotations,
    ],
  },
  stateMachine: {
    kind: 'stateMachine',
    category: 'behavioral',
    status: 'complete',
    glyph: 'state',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.states',
        tools: [
          node('sm.state', 'elementKind.state', 'state', 'state'),
          node('sm.composite', 'toolbox.compositeState', 'compositeState', 'state', { size: { width: 300, height: 200 } }),
          node('sm.initial', 'toolbox.initialState', 'initial', 'pseudostate', { subKind: 'initial' }),
          node('sm.final', 'toolbox.finalState', 'final', 'finalState'),
        ],
      },
      {
        titleKey: 'toolbox.groups.pseudostates',
        tools: [
          node('sm.choice', 'toolbox.choice', 'decision', 'pseudostate', { subKind: 'choice' }),
          node('sm.junction', 'toolbox.junction', 'junction', 'pseudostate', { subKind: 'junction' }),
          node('sm.fork', 'toolbox.fork', 'bar', 'pseudostate', { subKind: 'fork' }),
          node('sm.join', 'toolbox.join', 'bar', 'pseudostate', { subKind: 'join' }),
          node('sm.shallowHistory', 'toolbox.shallowHistory', 'history', 'pseudostate', { subKind: 'shallowHistory' }),
          node('sm.deepHistory', 'toolbox.deepHistory', 'history', 'pseudostate', { subKind: 'deepHistory' }),
          node('sm.entryPoint', 'toolbox.entryPoint', 'entryPoint', 'pseudostate', { subKind: 'entryPoint' }),
          node('sm.exitPoint', 'toolbox.exitPoint', 'exitPoint', 'pseudostate', { subKind: 'exitPoint' }),
          node('sm.terminate', 'toolbox.terminate', 'terminate', 'pseudostate', { subKind: 'terminate' }),
        ],
      },
      { titleKey: 'toolbox.groups.relationships', tools: [rel('sm.transition', 'elementKind.transition', 'flow', 'transition')] },
      annotations,
    ],
  },
  package: {
    kind: 'package',
    category: 'structural',
    status: 'partial',
    glyph: 'package',
    supportsCodegen: true,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('pkg.package', 'elementKind.package', 'package', 'package'),
          node('pkg.class', 'elementKind.class', 'class', 'class'),
          node('pkg.interface', 'elementKind.interface', 'interface', 'interface'),
          node('pkg.component', 'elementKind.component', 'component', 'component'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('pkg.import', 'elementKind.packageImport', 'dependency', 'packageImport'),
          rel('pkg.merge', 'elementKind.packageMerge', 'dependency', 'packageMerge'),
          rel('pkg.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
          rel('pkg.generalization', 'elementKind.generalization', 'generalization', 'generalization'),
        ],
      },
      annotations,
    ],
  },
  object: {
    kind: 'object',
    category: 'structural',
    status: 'partial',
    glyph: 'object',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [node('obj.instance', 'elementKind.instanceSpecification', 'object', 'instanceSpecification'), node('obj.class', 'elementKind.class', 'class', 'class')],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [rel('obj.link', 'elementKind.link', 'association', 'link'), rel('obj.dependency', 'elementKind.dependency', 'dependency', 'dependency')],
      },
      annotations,
    ],
  },
  component: {
    kind: 'component',
    category: 'structural',
    status: 'partial',
    glyph: 'component',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('cmp.component', 'elementKind.component', 'component', 'component'),
          node('cmp.interface', 'elementKind.interface', 'interface', 'interface'),
          node('cmp.lollipop', 'toolbox.lollipop', 'lollipop', 'interface', { variant: 'alternate', size: { width: 60, height: 44 } }),
          node('cmp.port', 'elementKind.port', 'port', 'port'),
          node('cmp.artifact', 'elementKind.artifact', 'artifact', 'artifact'),
          node('cmp.class', 'elementKind.class', 'class', 'class'),
          node('cmp.package', 'elementKind.package', 'package', 'package'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('cmp.assembly', 'toolbox.assembly', 'assembly', 'assembly'),
          rel('cmp.connector', 'elementKind.connector', 'association', 'connector'),
          rel('cmp.realization', 'elementKind.realization', 'realization', 'realization'),
          rel('cmp.usage', 'toolbox.usage', 'dependency', 'usage'),
          rel('cmp.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
          rel('cmp.generalization', 'elementKind.generalization', 'generalization', 'generalization'),
        ],
      },
      annotations,
    ],
  },
  deployment: {
    kind: 'deployment',
    category: 'structural',
    status: 'partial',
    glyph: 'node',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('dep.node', 'elementKind.node', 'node', 'node'),
          node('dep.device', 'toolbox.device', 'node', 'node', { subKind: 'device' }),
          node('dep.env', 'toolbox.executionEnvironment', 'node', 'node', { subKind: 'executionEnvironment' }),
          node('dep.artifact', 'elementKind.artifact', 'artifact', 'artifact'),
          node('dep.component', 'elementKind.component', 'component', 'component'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('dep.path', 'elementKind.communicationPath', 'association', 'communicationPath'),
          rel('dep.deployment', 'elementKind.deployment', 'dependency', 'deployment'),
          rel('dep.manifestation', 'elementKind.manifestation', 'dependency', 'manifestation'),
          rel('dep.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
        ],
      },
      annotations,
    ],
  },
  compositeStructure: {
    kind: 'compositeStructure',
    category: 'structural',
    status: 'partial',
    glyph: 'composite',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('cs.class', 'elementKind.class', 'class', 'class', { size: { width: 320, height: 220 } }),
          node('cs.part', 'elementKind.part', 'part', 'part'),
          node('cs.port', 'elementKind.port', 'port', 'port'),
          node('cs.collaboration', 'elementKind.collaboration', 'collaboration', 'collaboration'),
          node('cs.interface', 'elementKind.interface', 'interface', 'interface'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('cs.connector', 'elementKind.connector', 'association', 'connector'),
          rel('cs.realization', 'elementKind.realization', 'realization', 'realization'),
          rel('cs.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
        ],
      },
      annotations,
    ],
  },
  communication: {
    kind: 'communication',
    category: 'interaction',
    status: 'partial',
    glyph: 'communication',
    supportsCodegen: false,
    groups: [
      { titleKey: 'toolbox.groups.lifelines', tools: [node('com.lifeline', 'elementKind.lifeline', 'lifeline', 'lifeline')] },
      { titleKey: 'toolbox.groups.relationships', tools: [rel('com.link', 'elementKind.connector', 'association', 'connector')] },
      annotations,
    ],
  },
  timing: { kind: 'timing', category: 'interaction', status: 'planned', glyph: 'timing', supportsCodegen: false, groups: [] },
  interactionOverview: {
    kind: 'interactionOverview',
    category: 'interaction',
    status: 'planned',
    glyph: 'activity',
    supportsCodegen: false,
    groups: [],
  },
  profile: {
    kind: 'profile',
    category: 'structural',
    status: 'partial',
    glyph: 'stereotype',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('pro.profile', 'elementKind.profile', 'package', 'profile'),
          node('pro.stereotype', 'elementKind.stereotype', 'stereotype', 'stereotype'),
          node('pro.metaclass', 'elementKind.metaclass', 'class', 'metaclass'),
          node('pro.class', 'elementKind.class', 'class', 'class'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [
          rel('pro.extension', 'elementKind.extension', 'extensionArrow', 'extension'),
          rel('pro.generalization', 'elementKind.generalization', 'generalization', 'generalization'),
          rel('pro.import', 'elementKind.packageImport', 'dependency', 'packageImport'),
          rel('pro.dependency', 'elementKind.dependency', 'dependency', 'dependency'),
        ],
      },
      annotations,
    ],
  },
  informationFlow: {
    kind: 'informationFlow',
    category: 'structural',
    status: 'partial',
    glyph: 'informationFlow',
    supportsCodegen: false,
    groups: [
      {
        titleKey: 'toolbox.groups.basic',
        tools: [
          node('if.item', 'elementKind.informationItem', 'informationItem', 'informationItem'),
          node('if.class', 'elementKind.class', 'class', 'class'),
          node('if.actor', 'elementKind.actor', 'actor', 'actor'),
          node('if.component', 'elementKind.component', 'component', 'component'),
          node('if.node', 'elementKind.node', 'node', 'node'),
        ],
      },
      {
        titleKey: 'toolbox.groups.relationships',
        tools: [rel('if.flow', 'elementKind.informationFlow', 'dependency', 'informationFlow'), rel('if.dependency', 'elementKind.dependency', 'dependency', 'dependency')],
      },
      annotations,
    ],
  },
};

const TOOL_INDEX = new Map<string, ToolDef>();
for (const entry of Object.values(DIAGRAM_CATALOG)) for (const g of entry.groups) for (const tool of g.tools) TOOL_INDEX.set(tool.id, tool);

export function findTool(id: string): ToolDef | undefined {
  return TOOL_INDEX.get(id);
}

export function toolsFor(kind: DiagramKind): ToolDef[] {
  return DIAGRAM_CATALOG[kind].groups.flatMap((g) => g.tools);
}

export function isEditable(kind: DiagramKind): boolean {
  return DIAGRAM_CATALOG[kind].status !== 'planned' && DIAGRAM_KIND_INFO[kind].renderMode !== 'none';
}

export const CATALOG_ORDER: DiagramKind[] = [...DIAGRAM_KINDS];
