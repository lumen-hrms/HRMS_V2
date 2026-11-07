import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Goes to the previous page in this tab's history. When the page was opened
 * directly (nothing to go back to) it goes to `fallback` instead, so the
 * button never dead-ends or leaves the app.
 */
export function BackButton({ fallback = '/', className }: { fallback?: string; className?: string }) {
  const navigate = useNavigate();
  function back() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  }
  return (
    <button
      type="button"
      onClick={back}
      className={cn(
        '-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}
