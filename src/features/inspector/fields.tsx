import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { COMMON_MULTIPLICITIES, parseMultiplicity } from '@/domain/notation/multiplicity';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/controls';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Text field committing on blur/Enter (one undoable command per edit session), reverting on Esc.
 * `validate` returns an error message to block invalid input from reaching the model.
 */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  validate,
  list,
  hint,
  testId,
  compact,
  className,
  disabled,
}: {
  label?: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  validate?: (value: string) => string | null;
  list?: string;
  hint?: string;
  testId?: string;
  compact?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const commit = () => {
    editing.current = false;
    if (draft === value) return;
    const problem = validate?.(draft) ?? null;
    setError(problem);
    if (problem) return;
    onCommit(draft);
  };
  const input = (
    <Input
      id={id}
      value={draft}
      list={list}
      placeholder={placeholder}
      invalid={!!error}
      disabled={disabled}
      data-testid={testId}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={className}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (error) setError(validate?.(e.target.value) ?? null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          setError(null);
          editing.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
  if (compact || !label) return error ? <div className="flex flex-col">{input}<span className="text-[11px] text-danger">{error}</span></div> : input;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      {input}
    </Field>
  );
}

export function MultiplicityField(props: { label?: string; value: string; onCommit: (value: string) => void; compact?: boolean; testId?: string }) {
  const t = useT();
  return (
    <>
      <TextField
        {...props}
        list="uml-multiplicities"
        placeholder="1, 0..1, *"
        validate={(v) => (parseMultiplicity(v).ok ? null : t('inspector.invalidMultiplicity'))}
        onCommit={(v) => {
          const parsed = parseMultiplicity(v);
          if (parsed.ok) props.onCommit(parsed.normalized);
        }}
      />
    </>
  );
}

export function MultiplicityDatalist() {
  return (
    <datalist id="uml-multiplicities">
      {COMMON_MULTIPLICITIES.map((m) => (
        <option key={m} value={m} />
      ))}
    </datalist>
  );
}

export function AreaField({ label, value, onCommit, placeholder, testId, rows = 6 }: { label: string; value: string; onCommit: (value: string) => void; placeholder?: string; testId?: string; rows?: number }) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <Field label={label} htmlFor={id}>
      <Textarea
        id={id}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        data-testid={testId}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          editing.current = false;
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
            editing.current = false;
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  compact,
  testId,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  compact?: boolean;
  testId?: string;
}) {
  const id = useId();
  const select = (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={compact ? label : undefined} title={compact ? label : undefined} data-testid={testId}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
  if (compact) return select;
  return (
    <Field label={label} htmlFor={id}>
      {select}
    </Field>
  );
}

export function NumberField({ label, value, onCommit, min, max, step = 1, testId }: { label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; step?: number; testId?: string }) {
  return (
    <TextField
      label={label}
      value={String(Math.round(value * 100) / 100)}
      testId={testId}
      validate={(v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || v.trim() === '') return '#';
        if (min !== undefined && n < min) return `≥ ${min}`;
        if (max !== undefined && n > max) return `≤ ${max}`;
        return null;
      }}
      onCommit={(v) => onCommit(Math.round(Number(v) / step) * step)}
    />
  );
}

export function CheckField({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (value: boolean) => void; testId?: string }) {
  return (
    <span data-testid={testId}>
      <Checkbox label={label} checked={checked} onChange={onChange} />
    </span>
  );
}

export function ColorField({ label, value, fallback, onChange }: { label: string; value: string | undefined; fallback: string; onChange: (value: string | undefined) => void }) {
  const t = useT();
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <input id={id} type="color" className="h-7 w-10 cursor-pointer rounded border border-border-strong bg-surface-1 p-0.5" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
        <span className="font-mono text-[11.5px] text-muted">{value ?? '—'}</span>
        {value && (
          <button type="button" className="ml-auto rounded p-1 text-faint hover:bg-surface-3 hover:text-fg" onClick={() => onChange(undefined)} aria-label={t('inspector.resetStyle')} title={t('inspector.resetStyle')}>
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </Field>
  );
}

export function Section({ title, children, actions, className }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5 border-b border-border px-3 py-3', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
