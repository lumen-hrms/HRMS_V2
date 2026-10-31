import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { formatDuration } from '@/lib/attendance-day';

/**
 * Asked before clocking out with less than the shift's required hours:
 * "you've only worked X of the Y required". Clocking out stays possible —
 * this only makes sure it isn't an accident. Shared by the dashboard card and
 * the Attendance page so both behave identically.
 */
export function EarlyClockOutDialog({
  open,
  workedMs,
  targetMs,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  workedMs: number;
  targetMs: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const pct = targetMs > 0 ? Math.min(100, Math.round((workedMs / targetMs) * 100)) : 0;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-labelledby="early-clock-out-title">
        <DialogHeader
          title="Clock out early?"
          description={`You've only worked ${formatDuration(workedMs)} of the ${formatDuration(targetMs)} required today.`}
          onClose={onCancel}
        />
        <div className="flex flex-col gap-4">
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Hours worked today as a share of the requirement"
            >
              <div className="h-full rounded-r-[4px] bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatDuration(Math.max(targetMs - workedMs, 0))} to go
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" autoFocus onClick={onCancel}>
              Keep working
            </Button>
            <Button disabled={busy} onClick={onConfirm}>
              Clock out anyway
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
