import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  details?: string[];
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, 'id'>, timeoutMs?: number): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push(toast, timeoutMs) {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-4), { ...toast, id }] });
    const timeout = timeoutMs ?? (toast.kind === 'error' ? 9000 : toast.action ? 7000 : 3500);
    if (timeout > 0) setTimeout(() => get().dismiss(id), timeout);
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  info: (message: string, extra: Partial<Omit<Toast, 'id' | 'kind' | 'message'>> = {}) =>
    useToastStore.getState().push({ kind: 'info', message, ...extra }),
  success: (message: string, extra: Partial<Omit<Toast, 'id' | 'kind' | 'message'>> = {}) =>
    useToastStore.getState().push({ kind: 'success', message, ...extra }),
  warning: (message: string, extra: Partial<Omit<Toast, 'id' | 'kind' | 'message'>> = {}) =>
    useToastStore.getState().push({ kind: 'warning', message, ...extra }),
  error: (message: string, extra: Partial<Omit<Toast, 'id' | 'kind' | 'message'>> = {}) =>
    useToastStore.getState().push({ kind: 'error', message, ...extra }),
};
