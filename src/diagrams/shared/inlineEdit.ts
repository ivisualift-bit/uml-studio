import { renameElementCommands, resolveTypeElement } from '@/domain/commands/creators';
import type { Command } from '@/domain/commands/types';
import type { IdGenerator } from '@/domain/ids';
import { makeParameter } from '@/domain/model/factory';
import {
  formatGuard,
  formatMessageLabel,
  formatTransitionLabel,
  parseGuard,
  parseMessageLabel,
  parseTransitionLabel,
} from '@/domain/notation/labels';
import {
  formatAttribute,
  formatOperation,
  parseAttributeText,
  parseOperationText,
} from '@/domain/notation/members';
import { parseMultiplicity } from '@/domain/notation/multiplicity';
import { hasFeatures, isRelationship, type ModelElement } from '@/domain/schemas/elements';
import type { ProjectDocument, UMLDiagram } from '@/domain/schemas/project';
import type { EditTarget } from '@/stores/editorStore';

export type EditResult =
  { ok: true; commands: Command[] } | { ok: false; error: 'invalidMemberText' | 'invalidMultiplicity' };

const SPLIT_TYPED = new Set(['lifeline', 'instanceSpecification', 'part', 'port', 'objectNode']);

function typedName(el: ModelElement): string {
  switch (el.kind) {
    case 'lifeline':
    case 'part':
    case 'port':
    case 'objectNode':
      return el.typeElementId ? el.name : el.typeName ? `${el.name} : ${el.typeName}` : el.name;
    case 'instanceSpecification':
      return el.classifierId ? el.name : el.classifierName ? `${el.name} : ${el.classifierName}` : el.name;
    default:
      return el.name;
  }
}

/** Text shown in the inline editor when it opens. */
export function initialEditText(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  viewId: string,
  target: EditTarget,
): string {
  const view = diagram.views[viewId];
  if (!view) return '';
  if (view.kind === 'note') return view.text;
  if (!('elementId' in view)) return '';
  const el = doc.modelElements[view.elementId];
  if (!el) return '';
  if (target.type === 'name') return typedName(el);
  if (target.type === 'member') {
    if (target.collection === 'attributes' && hasFeatures(el)) {
      const a = el.attributes.find((m) => m.id === target.memberId);
      return a ? `${a.isStatic ? 'static ' : ''}${formatAttribute(a)}` : '';
    }
    if (target.collection === 'operations' && hasFeatures(el)) {
      const o = el.operations.find((m) => m.id === target.memberId);
      return o ? `${o.isStatic ? 'static ' : ''}${formatOperation(o)}` : '';
    }
    if (target.collection === 'literals' && el.kind === 'enumeration')
      return el.literals.find((m) => m.id === target.memberId)?.name ?? '';
    if (target.collection === 'extensionPoints' && el.kind === 'useCase')
      return el.extensionPoints.find((m) => m.id === target.memberId)?.name ?? '';
    if (target.collection === 'slots' && el.kind === 'instanceSpecification') {
      const s = el.slots.find((m) => m.id === target.memberId);
      return s ? `${s.name} = ${s.value}` : '';
    }
    if (target.collection === 'tagDefinitions' && el.kind === 'stereotype') {
      const tag = el.tagDefinitions.find((m) => m.id === target.memberId);
      return tag ? `${tag.name}: ${tag.type}${tag.defaultValue ? ` = ${tag.defaultValue}` : ''}` : '';
    }
    if (target.collection === 'operands' && el.kind === 'combinedFragment') {
      const o = el.operands.find((m) => m.id === target.memberId);
      return o ? o.guard : '';
    }
    return '';
  }
  // Labels
  if (el.kind === 'message') return formatMessageLabel(el.name, el.arguments, el.sort);
  if (!isRelationship(el)) return el.name;
  switch (target.key) {
    case 'stereotype':
      return el.stereotype;
    case 'sourceRole':
    case 'targetRole':
    case 'sourceMultiplicity':
    case 'targetMultiplicity': {
      if (!('sourceEnd' in el)) return '';
      const end = target.key.startsWith('source') ? el.sourceEnd : el.targetEnd;
      return target.key.endsWith('Role') ? end.name : end.multiplicity;
    }
    default:
      if (el.kind === 'transition') return formatTransitionLabel(el);
      if (el.kind === 'controlFlow' || el.kind === 'objectFlow')
        return [el.name, formatGuard(el.guard)].filter(Boolean).join(' ');
      return el.name;
  }
}

function splitTyped(text: string): { name: string; type: string | null } {
  const index = text.indexOf(':');
  if (index < 0) return { name: text.trim(), type: null };
  return { name: text.slice(0, index).trim(), type: text.slice(index + 1).trim() };
}

/** Turn edited text into commands (UML notation is parsed for members, labels and ends). */
export function commitInlineEdit(
  doc: ProjectDocument,
  diagram: UMLDiagram,
  viewId: string,
  target: EditTarget,
  text: string,
  ids: IdGenerator,
): EditResult {
  const view = diagram.views[viewId];
  if (!view) return { ok: true, commands: [] };
  if (view.kind === 'note')
    return { ok: true, commands: [{ type: 'view/update', diagramId: diagram.id, viewId, patch: { text } }] };
  if (!('elementId' in view)) return { ok: true, commands: [] };
  const el = doc.modelElements[view.elementId];
  if (!el) return { ok: true, commands: [] };
  const value = text.trim();

  if (target.type === 'name') {
    if (SPLIT_TYPED.has(el.kind)) {
      const { name, type } = splitTyped(value);
      const patch: Record<string, unknown> = { name };
      const hasSemanticType =
        el.kind === 'instanceSpecification' ? !!el.classifierId : 'typeElementId' in el && !!el.typeElementId;
      if (type !== null && !hasSemanticType)
        patch[el.kind === 'instanceSpecification' ? 'classifierName' : 'typeName'] = type;
      return { ok: true, commands: [{ type: 'element/update', elementId: el.id, patch }] };
    }
    return { ok: true, commands: renameElementCommands(doc, el.id, value) };
  }

  if (target.type === 'member') {
    const base = { elementId: el.id, memberId: target.memberId };
    switch (target.collection) {
      case 'attributes': {
        const parsed = parseAttributeText(value);
        if (!parsed) return { ok: false, error: 'invalidMemberText' };
        const { visibility, ...rest } = parsed;
        const patch = {
          ...rest,
          typeElementId: resolveTypeElement(doc, rest.type),
          ...(visibility ? { visibility } : {}),
        };
        return { ok: true, commands: [{ type: 'member/update', ...base, collection: 'attributes', patch }] };
      }
      case 'operations': {
        const parsed = parseOperationText(value);
        if (!parsed || !hasFeatures(el)) return { ok: false, error: 'invalidMemberText' };
        const existing = el.operations.find((o) => o.id === target.memberId);
        const parameters = parsed.parameters.map((p, i) =>
          makeParameter({
            ...p,
            id: existing?.parameters[i]?.id ?? ids.next(),
            typeElementId: resolveTypeElement(doc, p.type),
          }),
        );
        const { visibility, parameters: _p, ...rest } = parsed;
        const patch = {
          ...rest,
          returnTypeElementId: resolveTypeElement(doc, rest.returnType),
          ...(visibility ? { visibility } : {}),
          parameters,
        };
        return { ok: true, commands: [{ type: 'member/update', ...base, collection: 'operations', patch }] };
      }
      case 'slots': {
        const eq = value.indexOf('=');
        const patch =
          eq < 0 ? { name: value } : { name: value.slice(0, eq).trim(), value: value.slice(eq + 1).trim() };
        return { ok: true, commands: [{ type: 'member/update', ...base, collection: 'slots', patch }] };
      }
      case 'tagDefinitions': {
        const m = /^([^:=]+)(?::\s*(string|integer|boolean|real))?(?:\s*=\s*(.*))?$/.exec(value);
        if (!m) return { ok: false, error: 'invalidMemberText' };
        const patch: Record<string, unknown> = { name: m[1]!.trim() };
        if (m[2]) patch.type = m[2];
        if (m[3] !== undefined) patch.defaultValue = m[3].trim();
        return {
          ok: true,
          commands: [{ type: 'member/update', ...base, collection: 'tagDefinitions', patch }],
        };
      }
      case 'operands':
        return {
          ok: true,
          commands: [
            { type: 'member/update', ...base, collection: 'operands', patch: { guard: parseGuard(value) } },
          ],
        };
      default:
        return {
          ok: true,
          commands: [
            { type: 'member/update', ...base, collection: target.collection, patch: { name: value } },
          ],
        };
    }
  }

  // Edge / message labels.
  if (el.kind === 'message') {
    const parsed =
      el.sort === 'reply'
        ? { name: value, arguments: '' }
        : parseMessageLabel(value.replace(/^\d+(\.\d+)*:\s*/, ''));
    return { ok: true, commands: [{ type: 'element/update', elementId: el.id, patch: parsed }] };
  }
  if (!isRelationship(el))
    return { ok: true, commands: [{ type: 'element/update', elementId: el.id, patch: { name: value } }] };
  switch (target.key) {
    case 'stereotype':
      return {
        ok: true,
        commands: [
          {
            type: 'element/update',
            elementId: el.id,
            patch: { stereotype: value.replace(/^«|»$/g, '').trim() },
          },
        ],
      };
    case 'sourceRole':
    case 'targetRole':
    case 'sourceMultiplicity':
    case 'targetMultiplicity': {
      if (!('sourceEnd' in el)) return { ok: true, commands: [] };
      const endKey = target.key.startsWith('source') ? 'sourceEnd' : 'targetEnd';
      const end = el[endKey];
      if (target.key.endsWith('Multiplicity')) {
        const parsed = parseMultiplicity(value);
        if (!parsed.ok) return { ok: false, error: 'invalidMultiplicity' };
        return {
          ok: true,
          commands: [
            {
              type: 'element/update',
              elementId: el.id,
              patch: { [endKey]: { ...end, multiplicity: parsed.normalized } },
            },
          ],
        };
      }
      return {
        ok: true,
        commands: [
          { type: 'element/update', elementId: el.id, patch: { [endKey]: { ...end, name: value } } },
        ],
      };
    }
    default:
      if (el.kind === 'transition')
        return {
          ok: true,
          commands: [{ type: 'element/update', elementId: el.id, patch: { ...parseTransitionLabel(value) } }],
        };
      if (el.kind === 'controlFlow' || el.kind === 'objectFlow') {
        const open = value.indexOf('[');
        const close = value.lastIndexOf(']');
        const guard = open >= 0 && close > open ? value.slice(open + 1, close).trim() : '';
        const name = (
          open >= 0 && close > open ? value.slice(0, open) + value.slice(close + 1) : value
        ).trim();
        return { ok: true, commands: [{ type: 'element/update', elementId: el.id, patch: { name, guard } }] };
      }
      return { ok: true, commands: [{ type: 'element/update', elementId: el.id, patch: { name: value } }] };
  }
}
