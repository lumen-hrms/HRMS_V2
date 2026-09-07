import { Check, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/pages/leave/shared';
import type { LeaveApprovalStep, LeaveRequestStatus } from '@/lib/leave/types';

/**
 * Vertical approval trail for a single request: submitted → L1 → L2 → outcome.
 * Pending steps are muted; the current step (next to act) gets a ring.
 */
export function StatusTimeline({
  createdAt,
  approvals,
  status,
}: {
  createdAt: string;
  approvals: LeaveApprovalStep[];
  status: LeaveRequestStatus;
}) {
  const currentLevel = status === 'PENDING_L1' ? 1 : status === 'PENDING_L2' ? 2 : null;

  return (
    <ol className="flex flex-col">
      <Step
        state="done"
        title="Request submitted"
        sub={fmtDate(createdAt)}
        last={false}
      />
      {approvals.map((a, i) => {
        const state: StepState =
          a.decision === 'APPROVED'
            ? 'done'
            : a.decision === 'REJECTED'
              ? 'rejected'
              : currentLevel === a.level
                ? 'current'
                : 'pending';
        return (
          <Step
            key={a.level}
            state={state}
            title={`Level ${a.level} · ${a.approverRole}`}
            sub={
              a.decision
                ? `${a.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by ${a.approverName}${a.decidedAt ? ' · ' + fmtDate(a.decidedAt) : ''}`
                : `Awaiting ${a.approverName}`
            }
            comment={a.comment}
            last={i === approvals.length - 1}
          />
        );
      })}
    </ol>
  );
}

type StepState = 'done' | 'rejected' | 'current' | 'pending';

function Step({
  state,
  title,
  sub,
  comment,
  last,
}: {
  state: StepState;
  title: string;
  sub: string;
  comment?: string | null;
  last: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
            state === 'done' && 'border-transparent bg-success/15 text-success',
            state === 'rejected' && 'border-transparent bg-destructive/15 text-destructive',
            state === 'current' && 'border-warning bg-warning/10 text-warning ring-2 ring-warning/30',
            state === 'pending' && 'border-border bg-muted text-muted-foreground',
          )}
        >
          {state === 'done' ? (
            <Check className="h-3.5 w-3.5" />
          ) : state === 'rejected' ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('pb-4', last && 'pb-0')}>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
        {comment && (
          <p className="mt-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground">“{comment}”</p>
        )}
      </div>
    </li>
  );
}
