import type { ID } from '@/domain/schemas/common';
import {
  isRelationship,
  type ElementOf,
  type ModelElement,
  type Relationship,
} from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import type { FragmentView, MessageView } from '@/domain/schemas/views';
import { formatGuard, formatMessageLabel, formatTransitionLabel } from '@/domain/notation/labels';
import { formatAttribute, formatOperation, VISIBILITY_SYMBOL } from '@/domain/notation/members';
import { orderMessages } from '@/diagrams/render/sequenceLayout';

export type TextFormat = 'mermaid' | 'plantuml';

export interface TextExportResult {
  supported: boolean;
  text: string;
  /** Human-readable notes about information the target format cannot express. */
  lost: string[];
}

const UNSUPPORTED: TextExportResult = { supported: false, text: '', lost: [] };

/** Stable alias for an element (formats need identifiers; names may contain spaces/accents). */
function aliases(elements: ModelElement[]): Map<ID, string> {
  const map = new Map<ID, string>();
  const used = new Set<string>();
  for (const el of elements) {
    let base =
      el.name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/^(\d)/, '_$1') || el.kind;
    if (base.length > 40) base = base.slice(0, 40);
    let alias = base;
    for (let i = 2; used.has(alias); i += 1) alias = `${base}_${i}`;
    used.add(alias);
    map.set(el.id, alias);
  }
  return map;
}

const quote = (s: string) => `"${s.replace(/"/g, "'").replace(/\n/g, ' ')}"`;
const clean = (s: string) => s.replace(/[\n\r]+/g, ' ').replace(/[;#]/g, ',');

function shown(doc: ProjectDocument, diagram: UMLDiagram): { nodes: ModelElement[]; rels: Relationship[] } {
  const nodeIds = new Set<ID>();
  const relIds = new Set<ID>();
  for (const v of Object.values(diagram.views)) {
    if (v.kind === 'node') nodeIds.add(v.elementId);
    if (v.kind === 'edge') relIds.add(v.elementId);
  }
  return {
    nodes: [...nodeIds].map((id) => doc.modelElements[id]).filter((e): e is ModelElement => !!e),
    rels: [...relIds]
      .map((id) => doc.modelElements[id])
      .filter((e): e is Relationship => !!e && isRelationship(e)),
  };
}

// -------------------------------------------------------------------------------------------------
// Class diagrams
// -------------------------------------------------------------------------------------------------

function classMermaid(doc: ProjectDocument, diagram: UMLDiagram): TextExportResult {
  const { nodes, rels } = shown(doc, diagram);
  const lost: string[] = [];
  const names = aliases(nodes);
  const lines = ['classDiagram'];
  for (const el of nodes) {
    const alias = names.get(el.id)!;
    if (el.kind === 'package' || el.kind === 'model' || el.kind === 'profile') {
      lost.push(`Package "${el.name}" (Mermaid class diagrams have no packages)`);
      continue;
    }
    const label = alias !== el.name ? `${alias}["${clean(el.name)}"]` : alias;
    lines.push(`  class ${label} {`);
    const kw =
      el.kind === 'interface'
        ? 'interface'
        : el.kind === 'enumeration'
          ? 'enumeration'
          : 'isAbstract' in el && el.isAbstract
            ? 'abstract'
            : el.kind === 'dataType'
              ? 'dataType'
              : '';
    if (kw) lines.push(`    <<${kw}>>`);
    if (el.kind === 'enumeration') for (const l of el.literals) lines.push(`    ${clean(l.name)}`);
    if ('attributes' in el) {
      for (const a of el.attributes)
        lines.push(
          `    ${VISIBILITY_SYMBOL[a.visibility]}${clean(a.type ? `${a.type} ` : '')}${clean(a.name)}${a.isStatic ? '$' : ''}`,
        );
      for (const o of el.operations) {
        const params = o.parameters
          .filter((p) => p.direction !== 'return')
          .map((p) => clean(`${p.name}${p.type ? `: ${p.type}` : ''}`))
          .join(', ');
        lines.push(
          `    ${VISIBILITY_SYMBOL[o.visibility]}${clean(o.name)}(${params})${o.isAbstract ? '*' : o.isStatic ? '$' : ''}${o.returnType ? ` ${clean(o.returnType)}` : ''}`,
        );
      }
    }
    lines.push('  }');
  }
  for (const rel of rels) {
    const s = names.get(rel.sourceId);
    const t = names.get(rel.targetId);
    if (!s || !t) continue;
    const label = rel.name ? ` : ${clean(rel.name)}` : '';
    switch (rel.kind) {
      case 'generalization':
        lines.push(`  ${t} <|-- ${s}${label}`);
        break;
      case 'realization':
        lines.push(`  ${t} <|.. ${s}${label}`);
        break;
      case 'dependency':
        lines.push(`  ${s} ..> ${t}${label || (rel.stereotype ? ` : «${clean(rel.stereotype)}»` : '')}`);
        break;
      case 'association': {
        const sm = rel.sourceEnd.multiplicity ? ` ${quote(rel.sourceEnd.multiplicity)}` : '';
        const tm = rel.targetEnd.multiplicity ? `${quote(rel.targetEnd.multiplicity)} ` : '';
        let arrow = '--';
        if (rel.sourceEnd.aggregation === 'composite') arrow = '*--';
        else if (rel.sourceEnd.aggregation === 'shared') arrow = 'o--';
        else if (rel.targetEnd.aggregation === 'composite') arrow = '--*';
        else if (rel.targetEnd.aggregation === 'shared') arrow = '--o';
        else if (rel.targetEnd.navigability === 'navigable') arrow = '-->';
        lines.push(`  ${s}${sm} ${arrow} ${tm}${t}${label}`);
        if (rel.sourceEnd.name || rel.targetEnd.name)
          lost.push(`Role names of association ${rel.name || `${s}–${t}`}`);
        break;
      }
      default:
        lost.push(`${rel.kind} relationship`);
    }
  }
  return { supported: true, text: `${lines.join('\n')}\n`, lost };
}

function classPlantUml(doc: ProjectDocument, diagram: UMLDiagram): TextExportResult {
  const { nodes, rels } = shown(doc, diagram);
  const lost: string[] = [];
  const names = aliases(nodes);
  const lines = ['@startuml', `title ${clean(diagram.name)}`];
  for (const el of nodes) {
    const alias = names.get(el.id)!;
    const display = quote(el.name);
    if (el.kind === 'package' || el.kind === 'profile' || el.kind === 'model') {
      lines.push(`package ${display} as ${alias} {`, '}');
      continue;
    }
    const keyword =
      el.kind === 'interface'
        ? 'interface'
        : el.kind === 'enumeration'
          ? 'enum'
          : 'isAbstract' in el && el.isAbstract
            ? 'abstract class'
            : 'class';
    const stereo = el.stereotype
      ? ` <<${clean(el.stereotype)}>>`
      : el.kind === 'dataType'
        ? ' <<dataType>>'
        : el.kind === 'signal'
          ? ' <<signal>>'
          : '';
    lines.push(`${keyword} ${display} as ${alias}${stereo} {`);
    if (el.kind === 'enumeration') for (const l of el.literals) lines.push(`  ${clean(l.name)}`);
    if ('attributes' in el) {
      for (const a of el.attributes)
        lines.push(`  ${a.isStatic ? '{static} ' : ''}${clean(formatAttribute(a))}`);
      for (const o of el.operations)
        lines.push(
          `  ${o.isStatic ? '{static} ' : ''}${o.isAbstract ? '{abstract} ' : ''}${clean(formatOperation(o))}`,
        );
    }
    lines.push('}');
  }
  for (const rel of rels) {
    const s = names.get(rel.sourceId);
    const t = names.get(rel.targetId);
    if (!s || !t) continue;
    const label = rel.name ? ` : ${clean(rel.name)}` : '';
    switch (rel.kind) {
      case 'generalization':
        lines.push(`${t} <|-- ${s}${label}`);
        break;
      case 'realization':
        lines.push(`${t} <|.. ${s}${label}`);
        break;
      case 'dependency':
        lines.push(`${s} ..> ${t}${label || (rel.stereotype ? ` : <<${clean(rel.stereotype)}>>` : '')}`);
        break;
      case 'association': {
        const sEnd = [rel.sourceEnd.name, rel.sourceEnd.multiplicity].filter(Boolean).join(' ');
        const tEnd = [rel.targetEnd.name, rel.targetEnd.multiplicity].filter(Boolean).join(' ');
        let arrow = '--';
        if (rel.sourceEnd.aggregation === 'composite') arrow = '*--';
        else if (rel.sourceEnd.aggregation === 'shared') arrow = 'o--';
        else if (rel.targetEnd.aggregation === 'composite') arrow = '--*';
        else if (rel.targetEnd.aggregation === 'shared') arrow = '--o';
        else if (rel.targetEnd.navigability === 'navigable') arrow = '-->';
        lines.push(
          `${s}${sEnd ? ` ${quote(sEnd)}` : ''} ${arrow}${tEnd ? ` ${quote(tEnd)}` : ''} ${t}${label}`,
        );
        break;
      }
      default:
        lost.push(`${rel.kind} relationship`);
    }
  }
  lines.push('@enduml');
  return { supported: true, text: `${lines.join('\n')}\n`, lost };
}

// -------------------------------------------------------------------------------------------------
// Use case (PlantUML only)
// -------------------------------------------------------------------------------------------------

function plantUmlUseCase(doc: ProjectDocument, diagram: UMLDiagram): TextExportResult {
  const { nodes, rels } = shown(doc, diagram);
  const names = aliases(nodes);
  const lines = ['@startuml', `title ${clean(diagram.name)}`, 'left to right direction'];
  const lost: string[] = [];
  const insideBoundary = new Map<ID, ID>();
  for (const v of Object.values(diagram.views)) {
    if (v.kind !== 'node' || !v.containerViewId) continue;
    const container = diagram.views[v.containerViewId];
    if (container?.kind === 'node' && doc.modelElements[container.elementId]?.kind === 'subject')
      insideBoundary.set(v.elementId, container.elementId);
  }
  for (const el of nodes)
    if (el.kind === 'actor') lines.push(`actor ${quote(el.name)} as ${names.get(el.id)}`);
  const emitUseCase = (el: ModelElement, indent: string) =>
    lines.push(`${indent}usecase ${quote(el.name)} as ${names.get(el.id)}`);
  for (const el of nodes) {
    if (el.kind !== 'subject') continue;
    lines.push(`rectangle ${quote(el.name)} {`);
    for (const uc of nodes)
      if (uc.kind === 'useCase' && insideBoundary.get(uc.id) === el.id) emitUseCase(uc, '  ');
    lines.push('}');
  }
  for (const el of nodes) if (el.kind === 'useCase' && !insideBoundary.has(el.id)) emitUseCase(el, '');
  for (const rel of rels) {
    const s = names.get(rel.sourceId);
    const t = names.get(rel.targetId);
    if (!s || !t) continue;
    if (rel.kind === 'association') lines.push(`${s} -- ${t}`);
    else if (rel.kind === 'include') lines.push(`${s} ..> ${t} : <<include>>`);
    else if (rel.kind === 'extend')
      lines.push(`${s} ..> ${t} : <<extend>>${rel.condition ? `\\n[${clean(rel.condition)}]` : ''}`);
    else if (rel.kind === 'generalization') lines.push(`${t} <|-- ${s}`);
    else if (rel.kind === 'dependency') lines.push(`${s} ..> ${t}`);
    else lost.push(`${rel.kind} relationship`);
  }
  lines.push('@enduml');
  return { supported: true, text: `${lines.join('\n')}\n`, lost };
}

// -------------------------------------------------------------------------------------------------
// Sequence
// -------------------------------------------------------------------------------------------------

interface SeqEvent {
  y: number;
  order: number;
  line: (fmt: TextFormat) => string;
}

function sequenceText(doc: ProjectDocument, diagram: UMLDiagram, format: TextFormat): TextExportResult {
  const lost: string[] = [];
  const lifelineViews = Object.values(diagram.views)
    .filter((v) => v.kind === 'lifeline')
    .sort((a, b) => (a.kind === 'lifeline' && b.kind === 'lifeline' ? a.x - b.x : 0));
  const lifelines = lifelineViews
    .map((v) => (v.kind === 'lifeline' ? doc.modelElements[v.elementId] : undefined))
    .filter((e): e is ElementOf<'lifeline'> => e?.kind === 'lifeline');
  const names = aliases(lifelines);
  const byView = new Map<ID, string>();
  for (const v of lifelineViews) if (v.kind === 'lifeline') byView.set(v.id, names.get(v.elementId) ?? '');
  const lines = [format === 'mermaid' ? 'sequenceDiagram' : '@startuml'];
  if (format === 'plantuml') lines.push(`title ${clean(diagram.name)}`);
  const created = new Set<ID>();
  for (const v of Object.values(diagram.views)) {
    if (v.kind !== 'message') continue;
    const m = doc.modelElements[v.elementId];
    if (m?.kind === 'message' && m.sort === 'create' && v.targetViewId) created.add(v.targetViewId);
  }
  for (const v of lifelineViews) {
    if (v.kind !== 'lifeline' || created.has(v.id)) continue;
    const el = doc.modelElements[v.elementId];
    if (el?.kind !== 'lifeline') continue;
    const typeName = el.typeElementId
      ? (doc.modelElements[el.typeElementId]?.name ?? el.typeName)
      : el.typeName;
    const label = clean(typeName ? `${el.name}:${typeName}` : el.name);
    const keyword = el.headStyle === 'actor' ? 'actor' : 'participant';
    lines.push(
      format === 'mermaid'
        ? `  ${keyword} ${names.get(el.id)} as ${label}`
        : `${keyword} ${quote(label)} as ${names.get(el.id)}`,
    );
  }
  const events: SeqEvent[] = [];
  let order = 0;
  const messages = orderMessages(
    Object.values(diagram.views).filter((v): v is MessageView => v.kind === 'message'),
  );
  for (const v of messages) {
    const m = doc.modelElements[v.elementId];
    if (m?.kind !== 'message') continue;
    const from = v.sourceViewId ? byView.get(v.sourceViewId) : undefined;
    const to = v.targetViewId ? byView.get(v.targetViewId) : undefined;
    if (!from || !to) {
      lost.push(`Found/lost message "${m.name}"`);
      continue;
    }
    const text = clean(formatMessageLabel(m.name, m.arguments, m.sort) || ' ');
    const isCreate = m.sort === 'create';
    const isDestroy = m.sort === 'destroy';
    events.push({
      y: v.sendY,
      order: order++,
      line: (fmt) => {
        if (fmt === 'mermaid') {
          const arrow =
            m.sort === 'reply'
              ? '-->>'
              : m.sort === 'asynchronous'
                ? '-)'
                : m.sort === 'create'
                  ? '-->>'
                  : '->>';
          const prefix = isCreate ? `  create participant ${to}\n` : isDestroy ? `  destroy ${to}\n` : '';
          return `${prefix}  ${from}${arrow}${to}: ${text}`;
        }
        const arrow = m.sort === 'reply' ? '-->' : m.sort === 'asynchronous' ? '->>' : '->';
        if (isCreate) return `create ${to}\n${from} ${arrow} ${to} : ${text}`;
        return `${from} ${arrow} ${to} : ${text}${isDestroy ? `\ndestroy ${to}` : ''}`;
      },
    });
  }
  for (const v of Object.values(diagram.views)) {
    if (v.kind !== 'activation') continue;
    const who = byView.get(v.lifelineViewId);
    if (!who) continue;
    events.push({
      y: v.startY,
      order: order++,
      line: (fmt) => (fmt === 'mermaid' ? `  activate ${who}` : `activate ${who}`),
    });
    events.push({
      y: v.endY + 0.01,
      order: order++,
      line: (fmt) => (fmt === 'mermaid' ? `  deactivate ${who}` : `deactivate ${who}`),
    });
  }
  for (const v of Object.values(diagram.views)) {
    if (v.kind !== 'fragment') continue;
    const f = doc.modelElements[v.elementId];
    if (f?.kind !== 'combinedFragment') continue;
    const fv = v as FragmentView;
    if (f.operator === 'ref') {
      events.push({
        y: fv.y,
        order: order++,
        line: (fmt) =>
          fmt === 'mermaid'
            ? `  Note over ${[...byView.values()][0] ?? 'A'}: ref ${clean(f.operands[0]?.guard ?? '')}`
            : `ref over ${[...byView.values()].join(', ')} : ${clean(f.operands[0]?.guard ?? '')}`,
      });
      continue;
    }
    const supported =
      format === 'mermaid'
        ? ['alt', 'opt', 'loop', 'par', 'break', 'critical']
        : ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group'];
    const op = supported.includes(f.operator) ? f.operator : 'opt';
    if (op !== f.operator) lost.push(`"${f.operator}" fragment exported as "${op}"`);
    const keywordElse = op === 'par' ? 'and' : op === 'critical' ? 'option' : 'else';
    f.operands.forEach((operand, i) => {
      const y = i === 0 ? fv.y : (fv.operandYs[operand.id] ?? fv.y);
      events.push({
        y: y - 0.005,
        order: order++,
        line: (fmt) =>
          i === 0
            ? `${fmt === 'mermaid' ? '  ' : ''}${op} ${clean(operand.guard)}`
            : `${fmt === 'mermaid' ? '  ' : ''}${keywordElse} ${clean(operand.guard)}`,
      });
    });
    events.push({
      y: fv.y + fv.height - 0.005,
      order: order++,
      line: (fmt) => `${fmt === 'mermaid' ? '  ' : ''}end`,
    });
  }
  events.sort((a, b) => a.y - b.y || a.order - b.order);
  for (const e of events) lines.push(e.line(format));
  for (const v of Object.values(diagram.views)) if (v.kind === 'note') lost.push('Notes');
  if (format === 'plantuml') lines.push('@enduml');
  return { supported: true, text: `${lines.join('\n')}\n`, lost: [...new Set(lost)] };
}

// -------------------------------------------------------------------------------------------------
// State machine
// -------------------------------------------------------------------------------------------------

function stateText(doc: ProjectDocument, diagram: UMLDiagram, format: TextFormat): TextExportResult {
  const { nodes, rels } = shown(doc, diagram);
  const names = aliases(nodes);
  const lost: string[] = [];
  const ref = (id: ID): string => {
    const el = doc.modelElements[id];
    if (el?.kind === 'pseudostate' && el.pseudoKind === 'initial') return '[*]';
    if (el?.kind === 'finalState') return '[*]';
    return names.get(id) ?? 'unknown';
  };
  const lines = [format === 'mermaid' ? 'stateDiagram-v2' : '@startuml'];
  if (format === 'plantuml') lines.push(`title ${clean(diagram.name)}`);
  const childrenOf = (ownerId: ID) => nodes.filter((n) => n.ownerId === ownerId && n.kind === 'state');
  const emitState = (el: ModelElement, indent: string) => {
    const alias = names.get(el.id)!;
    const kids = childrenOf(el.id);
    if (format === 'mermaid') {
      if (alias !== el.name) lines.push(`${indent}state "${clean(el.name)}" as ${alias}`);
      if (kids.length) {
        lines.push(`${indent}state ${alias} {`);
        for (const k of kids) emitState(k, `${indent}  `);
        for (const t of rels)
          if (
            t.kind === 'transition' &&
            kids.some((k) => k.id === t.sourceId || k.id === t.targetId) &&
            doc.modelElements[t.sourceId]?.ownerId === el.id
          )
            lines.push(`${indent}  ${ref(t.sourceId)} --> ${ref(t.targetId)}`);
        lines.push(`${indent}}`);
      }
    } else {
      lines.push(`${indent}state ${quote(el.name)} as ${alias}${kids.length ? ' {' : ''}`);
      if (el.kind === 'state') {
        if (el.entry) lines.push(`${indent}${alias} : entry / ${clean(el.entry)}`);
        if (el.doActivity) lines.push(`${indent}${alias} : do / ${clean(el.doActivity)}`);
        if (el.exit) lines.push(`${indent}${alias} : exit / ${clean(el.exit)}`);
      }
      if (kids.length) {
        for (const k of kids) emitState(k, `${indent}  `);
        lines.push(`${indent}}`);
      }
    }
  };
  for (const el of nodes) {
    if (el.kind === 'state' && doc.modelElements[el.ownerId ?? '']?.kind !== 'state')
      emitState(el, format === 'mermaid' ? '  ' : '');
    if (el.kind === 'pseudostate' && !['initial'].includes(el.pseudoKind)) {
      if (
        format === 'mermaid' &&
        (el.pseudoKind === 'choice' || el.pseudoKind === 'fork' || el.pseudoKind === 'join')
      )
        lines.push(`  state ${names.get(el.id)} <<${el.pseudoKind}>>`);
      else if (
        format === 'plantuml' &&
        (el.pseudoKind === 'choice' || el.pseudoKind === 'fork' || el.pseudoKind === 'join')
      )
        lines.push(`state ${names.get(el.id)} <<${el.pseudoKind}>>`);
      else lost.push(`${el.pseudoKind} pseudostate`);
    }
    if (format === 'mermaid' && el.kind === 'state' && (el.entry || el.exit || el.doActivity))
      lost.push(`Internal activities of "${el.name}"`);
  }
  for (const rel of rels) {
    if (rel.kind !== 'transition') continue;
    const label = formatTransitionLabel(rel);
    const nested = doc.modelElements[doc.modelElements[rel.sourceId]?.ownerId ?? '']?.kind === 'state';
    if (format === 'mermaid' && nested) continue; // emitted inside the composite block
    lines.push(
      `${format === 'mermaid' ? '  ' : ''}${ref(rel.sourceId)} --> ${ref(rel.targetId)}${label ? ` : ${clean(label)}` : ''}`,
    );
  }
  if (format === 'plantuml') lines.push('@enduml');
  return { supported: true, text: `${lines.join('\n')}\n`, lost: [...new Set(lost)] };
}

// -------------------------------------------------------------------------------------------------
// Activity (flowchart-like subset)
// -------------------------------------------------------------------------------------------------

function activityText(doc: ProjectDocument, diagram: UMLDiagram, format: TextFormat): TextExportResult {
  const { nodes, rels } = shown(doc, diagram);
  const names = aliases(nodes);
  const lost: string[] = [];
  if (nodes.some((n) => n.kind === 'activityPartition')) lost.push('Swimlanes (partitions)');
  const lines: string[] = [];
  if (format === 'mermaid') {
    lines.push('flowchart TD');
    for (const el of nodes) {
      const id = names.get(el.id)!;
      const label = clean(el.name || ' ').replace(/"/g, "'");
      if (el.kind === 'action') lines.push(`  ${id}("${label}")`);
      else if (el.kind === 'objectNode') lines.push(`  ${id}["${label}"]`);
      else if (el.kind === 'controlNode') {
        if (el.nodeKind === 'initial') lines.push(`  ${id}(( ))`);
        else if (el.nodeKind === 'activityFinal' || el.nodeKind === 'flowFinal') lines.push(`  ${id}((( )))`);
        else if (el.nodeKind === 'decision' || el.nodeKind === 'merge')
          lines.push(`  ${id}{${label.trim() ? `"${label}"` : ' '}}`);
        else lines.push(`  ${id}[${el.nodeKind}]`);
      }
    }
    for (const rel of rels) {
      if (rel.kind !== 'controlFlow' && rel.kind !== 'objectFlow') continue;
      const s = names.get(rel.sourceId);
      const t = names.get(rel.targetId);
      if (!s || !t) continue;
      const guard = clean(formatGuard(rel.guard)).replace(/\|/g, '/');
      lines.push(`  ${s} -->${guard ? `|${guard}|` : ''} ${t}`);
    }
    return { supported: true, text: `${lines.join('\n')}\n`, lost };
  }
  // PlantUML legacy activity syntax supports arbitrary graphs.
  lines.push('@startuml', `title ${clean(diagram.name)}`);
  const term = (id: ID): string => {
    const el = doc.modelElements[id];
    if (el?.kind === 'controlNode' && el.nodeKind === 'initial') return '(*)';
    if (el?.kind === 'controlNode' && (el.nodeKind === 'activityFinal' || el.nodeKind === 'flowFinal'))
      return '(*)';
    if (el?.kind === 'controlNode' && (el.nodeKind === 'fork' || el.nodeKind === 'join'))
      return `===${names.get(id)}===`;
    if (el?.kind === 'controlNode' && (el.nodeKind === 'decision' || el.nodeKind === 'merge'))
      return `<> ${names.get(id)}`;
    return `${quote(el?.name ?? '')} as ${names.get(id)}`;
  };
  for (const rel of rels) {
    if (rel.kind !== 'controlFlow' && rel.kind !== 'objectFlow') continue;
    const guard = rel.guard ? ` [${clean(rel.guard)}]` : '';
    lines.push(`${term(rel.sourceId)} -->${guard} ${term(rel.targetId)}`);
  }
  lines.push('@enduml');
  return { supported: true, text: `${lines.join('\n')}\n`, lost };
}

export function exportDiagramText(doc: ProjectDocument, diagramId: ID, format: TextFormat): TextExportResult {
  const diagram = doc.diagrams[diagramId];
  if (!diagram) return UNSUPPORTED;
  switch (diagram.kind) {
    case 'class':
      return format === 'mermaid' ? classMermaid(doc, diagram) : classPlantUml(doc, diagram);
    case 'useCase':
      return format === 'plantuml' ? plantUmlUseCase(doc, diagram) : UNSUPPORTED;
    case 'sequence':
      return sequenceText(doc, diagram, format);
    case 'stateMachine':
      return stateText(doc, diagram, format);
    case 'activity':
      return activityText(doc, diagram, format);
    default:
      return UNSUPPORTED;
  }
}
