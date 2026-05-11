export type ToastKind = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  ts: number;
}

type Listener = (toast: ToastMessage | null) => void;

let current: ToastMessage | null = null;
let nextId = 1;
const listeners = new Set<Listener>();

function emit(t: ToastMessage | null) {
  current = t;
  listeners.forEach((l) => l(t));
}

export function showToast(kind: ToastKind, text: string): void {
  emit({ id: nextId++, kind, text, ts: Date.now() });
}

export const toast = {
  success: (text: string) => showToast("success", text),
  error: (text: string) => showToast("error", text),
  info: (text: string) => showToast("info", text),
};

export function subscribeToast(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getToastSnapshot(): ToastMessage | null {
  return current;
}

export function dismissToast(): void {
  emit(null);
}
