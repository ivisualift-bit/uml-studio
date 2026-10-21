import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DIAGRAM_FONT_FAMILY } from '@/diagrams/render/textMetrics';

interface Props {
  style: CSSProperties;
  initial: string;
  multiline?: boolean;
  fontSize: number;
  /** Return false to keep the editor open (invalid input). */
  onCommit: (text: string) => boolean;
  onCancel: () => void;
  ariaLabel: string;
}

/**
 * In-place editor for names, members and labels. Enter commits (Mod+Enter for multi-line notes),
 * Esc cancels, blur commits. Keystrokes never reach canvas shortcuts (stopPropagation).
 */
export function InlineTextEditor({ style, initial, multiline, fontSize, onCommit, onCancel, ariaLabel }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    if (value === initial) {
      done.current = true;
      onCancel();
      return;
    }
    if (onCommit(value)) done.current = true;
  };

  const common = {
    ref,
    value,
    'aria-label': ariaLabel,
    'data-testid': 'inline-editor',
    className: 'nodrag nopan nowheel absolute z-50 rounded-[3px] border border-accent bg-surface-1 px-1 text-fg shadow-lg outline-none',
    style: { ...style, fontSize, fontFamily: DIAGRAM_FONT_FAMILY },
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done.current = true;
        onCancel();
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
    onBlur: () => {
      if (!done.current) {
        // Invalid text on blur is discarded (the error toast explains why).
        if (!onCommit(value)) onCancel();
        done.current = true;
      }
    },
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  return multiline ? <textarea {...common} /> : <input {...common} />;
}
