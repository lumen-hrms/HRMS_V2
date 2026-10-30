import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * How long a suspend / deactivate / role change can take to reach every API
 * server — the API caches "who is this tenant / user" for this long
 * (`AUTH_CACHE_TTL_MS` in apps/api/src/common/tenancy/auth-context-cache.ts).
 * Keep the two in step.
 */
export const ACCESS_CHANGE_PROPAGATION_MS = 30_000;

/**
 * Shown inside a dialog once an access change has been saved: walks through
 * `steps` over the propagation window so the operator sees it taking effect
 * rather than staring at a frozen button. The change itself is already
 * saved — "Continue in background" just closes the dialog early.
 */
export function AccessChangeProgress({
  steps,
  doneLabel,
  onClose,
  durationMs = ACCESS_CHANGE_PROPAGATION_MS,
}: {
  steps: string[];
  doneLabel: string;
  onClose: () => void;
  durationMs?: number;
}) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const ms = Date.now() - start;
      setElapsed(ms);
      if (ms >= durationMs) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [durationMs]);

  const progress = Math.min(1, elapsed / durationMs);
  const finished = progress >= 1;
  // The first step is what the API call already did, so it starts ticked.
  const current = finished ? steps.length : Math.max(1, Math.floor(progress * steps.length));
  const secondsLeft = Math.ceil((durationMs - elapsed) / 1000);

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={step}
              className={cn(
                'flex items-center gap-2 text-sm',
                done
                  ? 'text-foreground'
                  : active
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {done ? (
                <Check className="h-4 w-4 shrink-0 text-lumen-success" />
              ) : active ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
              )}
              {step}
            </li>
          );
        })}
      </ol>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {finished ? doneLabel : `Applying on every server — about ${secondsLeft}s left`}
        </span>
        <Button variant={finished ? 'default' : 'outline'} onClick={onClose}>
          {finished ? 'Done' : 'Continue in background'}
        </Button>
      </div>
    </div>
  );
}
