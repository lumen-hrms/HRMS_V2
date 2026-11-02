import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PayrollRunStatus } from '@/lib/payroll/types';

const RUN_STEPS: Array<{ status: PayrollRunStatus; label: string; caption: string }> = [
  { status: 'DRAFT', label: 'Draft', caption: 'Check & adjust' },
  { status: 'REVIEW', label: 'Review', caption: '2 approvals' },
  { status: 'APPROVED', label: 'Approved', caption: 'Ready to process' },
  { status: 'PROCESSED', label: 'Processed', caption: 'Payslips made' },
  { status: 'DISBURSED', label: 'Disbursed', caption: 'Paid' },
];

export function RunStepper({
  status,
  compact = false,
}: {
  status: PayrollRunStatus;
  compact?: boolean;
}) {
  const current = RUN_STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="flex w-full items-start" aria-label="Run progress">
      {RUN_STEPS.map((step, i) => {
        // The last step has nothing after it, so reaching it counts as done.
        const done = i < current || status === 'DISBURSED';
        const active = i === current && status !== 'DISBURSED';
        return (
          <li key={step.status} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <div className="flex w-full items-center">
              <span className={cn('h-px flex-1', i === 0 ? 'bg-transparent' : done || active ? 'bg-primary' : 'bg-border')} />
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  compact ? 'h-5 w-5' : 'h-7 w-7',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && 'border-primary text-primary ring-4 ring-primary/20',
                  !done && !active && 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className={compact ? 'h-3 w-3' : 'h-4 w-4'} /> : i + 1}
              </span>
              <span className={cn('h-px flex-1', i === RUN_STEPS.length - 1 ? 'bg-transparent' : done ? 'bg-primary' : 'bg-border')} />
            </div>
            <span className={cn('text-xs font-medium', !done && !active && 'text-muted-foreground')}>{step.label}</span>
            {!compact && <span className="hidden text-[11px] text-muted-foreground sm:block">{step.caption}</span>}
          </li>
        );
      })}
    </ol>
  );
}
