import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Tooltip } from 'radix-ui';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'primary' | 'ghost' | 'danger' | 'subtle';

const variants: Record<Variant, string> = {
  default: 'bg-surface-3 text-fg border border-border-strong hover:bg-surface-4',
  primary: 'bg-accent text-accent-text border border-transparent hover:bg-accent-hover',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-3',
  subtle: 'bg-surface-2 text-muted border border-border hover:text-fg hover:bg-surface-3',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  /** Reason shown in the tooltip when disabled. */
  disabledReason?: string;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    shortcut,
    active,
    disabledReason,
    className,
    children,
    tooltipSide = 'bottom',
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent',
        active && 'bg-accent-muted text-accent hover:bg-accent-muted hover:text-accent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={tooltipSide}
          sideOffset={6}
          className="z-[70] max-w-xs rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-fg shadow-panel"
        >
          <span>{label}</span>
          {shortcut && <Kbd className="ml-2">{shortcut}</Kbd>}
          {disabled && disabledReason && <div className="mt-0.5 text-faint">{disabledReason}</div>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'rounded border border-border-strong bg-surface-1 px-1 font-mono text-[10.5px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const fieldBase =
  'w-full rounded-md border border-border-strong bg-surface-1 px-2 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-muted disabled:opacity-50';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        fieldBase,
        'h-7',
        invalid && 'border-danger focus:border-danger focus:ring-danger-muted',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(fieldBase, 'min-h-20 resize-y py-1.5 leading-snug', className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-7 pr-6', className)} {...props}>
      {children}
    </select>
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-fg',
        disabled && 'opacity-50',
      )}
      title={title}
    >
      <input
        id={id}
        type="checkbox"
        className="h-3.5 w-3.5 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  className,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-[11.5px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-faint">{hint}</span>
      ) : null}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
      <span>{children}</span>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}
