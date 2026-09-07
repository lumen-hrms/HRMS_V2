import * as React from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal toast system — context + hook + fixed viewport. No dependency; auto-
 * dismisses after `duration` (default 4s). Mount <ToastProvider> once near the
 * root; call `useToast().toast({ ... })` from anywhere below it.
 */

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}
interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastContextValue {
  toast: (t: ToastInput) => void;
}
const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, tone = 'success', duration = 4000 }: ToastInput) => {
      const id = nextId++;
      setItems((xs) => [...xs, { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const TONE_CLASS = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-muted-foreground',
} as const;

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon = TONE_ICON[item.tone];
  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-lg">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[item.tone])} />
      <div className="flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        onClick={onClose}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
