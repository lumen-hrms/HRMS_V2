import * as React from 'react';
import { Paperclip } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { StatusTimeline } from './status-timeline';
import { LeaveStatusBadge, LeaveTypeChip, LopBadge, dayLabel, fmtRange } from '@/pages/leave/shared';
import type { LeaveRequest } from '@/lib/leave/types';

export type DetailAction =
  | { kind: 'cancel'; run: () => Promise<void> }
  | { kind: 'decide'; run: (action: 'approve' | 'reject', comment: string) => Promise<void> };

/**
 * Slide-over for one leave request. `action` decides which controls show:
 *  - none        → read-only (Auditor, or a settled request)
 *  - cancel      → owner can withdraw a still-pending request
 *  - decide      → an approver acts on the level currently pending on them
 */
export function RequestDetailSheet({
  request,
  open,
  onOpenChange,
  action,
}: {
  request: LeaveRequest | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action?: DetailAction;
}) {
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setComment('');
  }, [open, request?.id]);

  if (!request) return null;

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const isPending = request.status === 'PENDING_L1' || request.status === 'PENDING_L2';

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${request.employee.firstName} ${request.employee.lastName}`.trim() || 'Leave request'}
      description={request.employee.department ?? undefined}
      footer={
        action && isPending ? (
          <div className="flex flex-col gap-3">
            {action.kind === 'decide' && (
              <Field label="Comment" hint="Shared with the employee and the next approver.">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Optional note…"
                  rows={2}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              {action.kind === 'cancel' ? (
                <Button variant="destructive" disabled={busy} onClick={() => guard(action.run)}>
                  {busy ? 'Cancelling…' : 'Withdraw request'}
                </Button>
              ) : (
                <>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => guard(() => action.run('reject', comment))}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="success"
                    disabled={busy}
                    onClick={() => guard(() => action.run('approve', comment))}
                  >
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <LeaveStatusBadge status={request.status} />
          {request.isLop && <LopBadge />}
          <LeaveTypeChip code={request.leaveType.code} colorToken={request.leaveType.colorToken} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Row label="Leave type" value={request.leaveType.name} />
          <Row label="Duration" value={`${fmtRange(request.startDate, request.endDate)} · ${dayLabel(request.days)}${request.halfDay ? ' (half day)' : ''}`} span />
          <Row label="Reason" value={request.reason || '—'} span />
          {request.attachmentName && (
            <Row
              label="Attachment"
              span
              value={
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <Paperclip className="h-3.5 w-3.5" />
                  {request.attachmentName}
                </span>
              }
            />
          )}
        </dl>

        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approval trail
          </p>
          <StatusTimeline
            createdAt={request.createdAt}
            approvals={request.approvals}
            status={request.status}
          />
        </div>
      </div>
    </Sheet>
  );
}

function Row({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
