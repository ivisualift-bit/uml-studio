import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { addMember, run } from '@/app/actions';
import { resolveTypeElement } from '@/domain/commands/creators';
import type { MemberCollection } from '@/domain/commands/types';
import { uuidGenerator } from '@/domain/ids';
import { makeParameter } from '@/domain/model/factory';
import {
  formatAttribute,
  formatOperation,
  parseAttributeText,
  parseOperationText,
} from '@/domain/notation/members';
import type { ID } from '@/domain/schemas/common';
import type { ClassifierWithFeatures } from '@/domain/schemas/elements';
import type { Attribute, Operation, Parameter, ParameterDirection } from '@/domain/schemas/members';
import { IconButton } from '@/components/ui/controls';
import { useT, type MessageKey } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { CheckField, MultiplicityField, Section, SelectField, TextField } from './fields';

const VISIBILITIES = ['public', 'private', 'protected', 'package'] as const;

export function TypeDatalist() {
  const names = useDocumentStore((s) => {
    const doc = s.doc;
    if (!doc) return '';
    return Object.values(doc.modelElements)
      .filter(
        (e) =>
          ['class', 'interface', 'enumeration', 'dataType', 'primitiveType', 'signal', 'component'].includes(
            e.kind,
          ) && e.name,
      )
      .map((e) => e.name)
      .sort()
      .join('\u0000');
  });
  const builtin = [
    'String',
    'Integer',
    'Boolean',
    'Real',
    'Date',
    'void',
    'int',
    'double',
    'string',
    'number',
    'boolean',
  ];
  const all = [...new Set([...builtin, ...(names ? names.split('\u0000') : [])])];
  return (
    <datalist id="uml-types">
      {all.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

function RowActions({
  index,
  count,
  onMove,
  onDelete,
  deleteLabel,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        label={t('common.moveUp')}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className="h-6 w-6"
      >
        <ArrowUp size={12} />
      </IconButton>
      <IconButton
        label={t('common.moveDown')}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className="h-6 w-6"
      >
        <ArrowDown size={12} />
      </IconButton>
      <IconButton label={deleteLabel} onClick={onDelete} className="h-6 w-6 hover:text-danger">
        <Trash2 size={12} />
      </IconButton>
    </div>
  );
}

function memberCommand(
  elementId: ID,
  collection: MemberCollection,
  memberId: ID,
  patch: Record<string, unknown>,
  label: string,
  operationId?: ID,
) {
  run({ type: 'member/update', elementId, collection, memberId, patch, operationId }, { label });
}

function AttributeRow({
  element,
  attribute,
  index,
}: {
  element: ClassifierWithFeatures;
  attribute: Attribute;
  index: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const doc = useDocumentStore((s) => s.doc)!;
  const label = t('history.edit', { field: attribute.name });
  const update = (patch: Record<string, unknown>) =>
    memberCommand(element.id, 'attributes', attribute.id, patch, label);
  return (
    <div
      className="rounded border border-border bg-surface-2"
      data-testid="attribute-row"
      data-member-id={attribute.id}
    >
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          className="text-faint hover:text-fg"
          onClick={() => setOpen((v) => !v)}
          aria-label={t('common.details')}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <TextField
          compact
          label={t('inspector.attributes')}
          value={formatAttribute(attribute)}
          className={attribute.isStatic ? 'underline' : undefined}
          testId="attribute-text"
          validate={(v) => (parseAttributeText(v) ? null : t('canvas.invalidMemberText', { text: v }))}
          onCommit={(v) => {
            const parsed = parseAttributeText(v);
            if (!parsed) return;
            const { visibility, isStatic: _static, ...rest } = parsed;
            update({
              ...rest,
              typeElementId: resolveTypeElement(doc, rest.type),
              ...(visibility ? { visibility } : {}),
            });
          }}
        />
        <RowActions
          index={index}
          count={element.attributes.length}
          deleteLabel={t('common.delete')}
          onMove={(to) =>
            run(
              {
                type: 'member/move',
                elementId: element.id,
                collection: 'attributes',
                memberId: attribute.id,
                toIndex: to,
              },
              { label: t('history.reorder') },
            )
          }
          onDelete={() =>
            run(
              {
                type: 'member/delete',
                elementId: element.id,
                collection: 'attributes',
                memberId: attribute.id,
              },
              { label: t('history.delete') },
            )
          }
        />
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-border p-2">
          <SelectField
            label={t('inspector.visibility')}
            value={attribute.visibility}
            options={VISIBILITIES.map((v) => ({ value: v, label: t(`visibility.${v}`) }))}
            onChange={(v) => update({ visibility: v })}
          />
          <TextField
            label={t('common.name')}
            value={attribute.name}
            onCommit={(v) => update({ name: v.trim() })}
            validate={(v) => (v.trim() && !/\s/.test(v.trim()) ? null : t('inspector.nameRequired'))}
          />
          <TextField
            label={t('common.type')}
            value={attribute.type}
            list="uml-types"
            onCommit={(v) => update({ type: v.trim(), typeElementId: resolveTypeElement(doc, v) })}
          />
          <MultiplicityField
            label={t('inspector.multiplicity')}
            value={attribute.multiplicity}
            onCommit={(v) => update({ multiplicity: v })}
          />
          <TextField
            label={t('inspector.defaultValue')}
            value={attribute.defaultValue}
            onCommit={(v) => update({ defaultValue: v.trim() })}
          />
          <div />
          <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1">
            <CheckField
              label={t('inspector.static')}
              checked={attribute.isStatic}
              onChange={(v) => update({ isStatic: v })}
            />
            <CheckField
              label={t('inspector.readOnly')}
              checked={attribute.isReadOnly}
              onChange={(v) => update({ isReadOnly: v })}
            />
            <CheckField
              label={t('inspector.derived')}
              checked={attribute.isDerived}
              onChange={(v) => update({ isDerived: v })}
            />
            <CheckField
              label={t('inspector.ordered')}
              checked={attribute.isOrdered}
              onChange={(v) => update({ isOrdered: v })}
            />
            <CheckField
              label={t('inspector.unique')}
              checked={attribute.isUnique}
              onChange={(v) => update({ isUnique: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ParameterRow({
  element,
  operation,
  parameter,
}: {
  element: ClassifierWithFeatures;
  operation: Operation;
  parameter: Parameter;
}) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const update = (patch: Record<string, unknown>) =>
    memberCommand(
      element.id,
      'parameters',
      parameter.id,
      patch,
      t('history.edit', { field: parameter.name }),
      operation.id,
    );
  return (
    <div className="flex items-center gap-1" data-testid="parameter-row">
      <SelectField<ParameterDirection>
        compact
        label={t('inspector.direction')}
        value={parameter.direction}
        options={(['in', 'out', 'inout', 'return'] as const).map((d) => ({
          value: d,
          label: t(`direction.${d}`),
        }))}
        onChange={(v) => update({ direction: v })}
      />
      <TextField
        compact
        label={t('common.name')}
        value={parameter.name}
        onCommit={(v) => update({ name: v.trim() })}
      />
      <TextField
        compact
        label={t('common.type')}
        value={parameter.type}
        list="uml-types"
        onCommit={(v) => update({ type: v.trim(), typeElementId: resolveTypeElement(doc, v) })}
      />
      <TextField
        compact
        label={t('inspector.defaultValue')}
        value={parameter.defaultValue}
        placeholder="="
        onCommit={(v) => update({ defaultValue: v.trim() })}
        className="w-14"
      />
      <IconButton
        label={t('common.delete')}
        className="h-6 w-6 shrink-0 hover:text-danger"
        onClick={() =>
          run(
            {
              type: 'member/delete',
              elementId: element.id,
              collection: 'parameters',
              operationId: operation.id,
              memberId: parameter.id,
            },
            { label: t('history.delete') },
          )
        }
      >
        <Trash2 size={12} />
      </IconButton>
    </div>
  );
}

function OperationRow({
  element,
  operation,
  index,
}: {
  element: ClassifierWithFeatures;
  operation: Operation;
  index: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const doc = useDocumentStore((s) => s.doc)!;
  const label = t('history.edit', { field: operation.name });
  const update = (patch: Record<string, unknown>) =>
    memberCommand(element.id, 'operations', operation.id, patch, label);
  return (
    <div
      className="rounded border border-border bg-surface-2"
      data-testid="operation-row"
      data-member-id={operation.id}
    >
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          className="text-faint hover:text-fg"
          onClick={() => setOpen((v) => !v)}
          aria-label={t('common.details')}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <TextField
          compact
          label={t('inspector.operations')}
          value={formatOperation(operation)}
          className={operation.isAbstract ? 'italic' : undefined}
          testId="operation-text"
          validate={(v) => (parseOperationText(v) ? null : t('canvas.invalidMemberText', { text: v }))}
          onCommit={(v) => {
            const parsed = parseOperationText(v);
            if (!parsed) return;
            const { visibility, isStatic: _s, parameters, ...rest } = parsed;
            update({
              ...rest,
              returnTypeElementId: resolveTypeElement(doc, rest.returnType),
              ...(visibility ? { visibility } : {}),
              parameters: parameters.map((p, i) =>
                makeParameter({
                  ...p,
                  id: operation.parameters[i]?.id ?? uuidGenerator.next(),
                  typeElementId: resolveTypeElement(doc, p.type),
                }),
              ),
            });
          }}
        />
        <RowActions
          index={index}
          count={element.operations.length}
          deleteLabel={t('common.delete')}
          onMove={(to) =>
            run(
              {
                type: 'member/move',
                elementId: element.id,
                collection: 'operations',
                memberId: operation.id,
                toIndex: to,
              },
              { label: t('history.reorder') },
            )
          }
          onDelete={() =>
            run(
              {
                type: 'member/delete',
                elementId: element.id,
                collection: 'operations',
                memberId: operation.id,
              },
              { label: t('history.delete') },
            )
          }
        />
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label={t('inspector.visibility')}
              value={operation.visibility}
              options={VISIBILITIES.map((v) => ({ value: v, label: t(`visibility.${v}`) }))}
              onChange={(v) => update({ visibility: v })}
            />
            <TextField
              label={t('common.name')}
              value={operation.name}
              onCommit={(v) => update({ name: v.trim() })}
              validate={(v) => (v.trim() && !/\s/.test(v.trim()) ? null : t('inspector.nameRequired'))}
            />
            <TextField
              label={t('inspector.returnType')}
              value={operation.returnType}
              list="uml-types"
              onCommit={(v) =>
                update({ returnType: v.trim(), returnTypeElementId: resolveTypeElement(doc, v) })
              }
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <CheckField
              label={t('inspector.static')}
              checked={operation.isStatic}
              onChange={(v) => update({ isStatic: v })}
            />
            <CheckField
              label={t('inspector.abstract')}
              checked={operation.isAbstract}
              onChange={(v) => update({ isAbstract: v })}
            />
            <CheckField
              label={t('inspector.query')}
              checked={operation.isQuery}
              onChange={(v) => update({ isQuery: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {t('inspector.parameters')}
            </span>
            <IconButton
              label={t('inspector.addParameter')}
              className="h-6 w-6"
              data-testid="add-parameter"
              onClick={() =>
                run(
                  {
                    type: 'member/add',
                    elementId: element.id,
                    collection: 'parameters',
                    operationId: operation.id,
                    member: makeParameter({
                      id: uuidGenerator.next(),
                      name: `${t('defaultName.parameter')}${operation.parameters.length + 1}`,
                      type: 'String',
                    }),
                  },
                  { label: t('inspector.addParameter') },
                )
              }
            >
              <Plus size={13} />
            </IconButton>
          </div>
          {operation.parameters.map((p) => (
            <ParameterRow key={p.id} element={element} operation={operation} parameter={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeatureEditors({ element }: { element: ClassifierWithFeatures }) {
  const t = useT();
  return (
    <>
      {element.kind === 'enumeration' && (
        <NamedListEditor
          title={t('inspector.literals')}
          elementId={element.id}
          collection="literals"
          items={element.literals}
          addLabel={t('inspector.addLiteral')}
          onAdd={() => void addMember('literals', element.id)}
        />
      )}
      <Section
        title={t('inspector.attributes')}
        actions={
          <IconButton
            label={t('inspector.addAttribute')}
            className="h-6 w-6"
            onClick={() => void addMember('attributes', element.id)}
            data-testid="inspector-add-attribute"
          >
            <Plus size={14} />
          </IconButton>
        }
      >
        {element.attributes.map((a, i) => (
          <AttributeRow key={a.id} element={element} attribute={a} index={i} />
        ))}
      </Section>
      <Section
        title={t('inspector.operations')}
        actions={
          <IconButton
            label={t('inspector.addOperation')}
            className="h-6 w-6"
            onClick={() => void addMember('operations', element.id)}
            data-testid="inspector-add-operation"
          >
            <Plus size={14} />
          </IconButton>
        }
      >
        {element.operations.map((o, i) => (
          <OperationRow key={o.id} element={element} operation={o} index={i} />
        ))}
      </Section>
    </>
  );
}

/** Generic ordered list of named members (literals, extension points…). */
export function NamedListEditor({
  title,
  elementId,
  collection,
  items,
  addLabel,
  onAdd,
  field = 'name',
  fieldLabel,
}: {
  title: string;
  elementId: ID;
  collection: MemberCollection;
  items: Array<{ id: ID } & Record<string, unknown>>;
  addLabel: string;
  onAdd: () => void;
  field?: string;
  fieldLabel?: MessageKey;
}) {
  const t = useT();
  return (
    <Section
      title={title}
      actions={
        <IconButton label={addLabel} className="h-6 w-6" onClick={onAdd} data-testid={`add-${collection}`}>
          <Plus size={14} />
        </IconButton>
      }
    >
      {items.map((item, i) => (
        <div key={item.id} className="flex items-center gap-1" data-testid={`${collection}-row`}>
          <TextField
            compact
            label={fieldLabel ? t(fieldLabel) : title}
            value={String(item[field] ?? '')}
            onCommit={(v) =>
              run(
                {
                  type: 'member/update',
                  elementId,
                  collection,
                  memberId: item.id,
                  patch: { [field]: v.trim() },
                },
                { label: t('history.edit', { field: title }) },
              )
            }
          />
          <RowActions
            index={i}
            count={items.length}
            deleteLabel={t('common.delete')}
            onMove={(to) =>
              run(
                { type: 'member/move', elementId, collection, memberId: item.id, toIndex: to },
                { label: t('history.reorder') },
              )
            }
            onDelete={() =>
              run(
                { type: 'member/delete', elementId, collection, memberId: item.id },
                { label: t('history.delete') },
              )
            }
          />
        </div>
      ))}
    </Section>
  );
}
