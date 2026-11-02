import * as React from 'react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

/** Replaces window.confirm: says exactly what becomes irreversible before the user commits. */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  if (!request) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader title={request.title} onClose={onClose} />
        <div className="mb-5 text-sm text-muted-foreground">{request.body}</div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request.onConfirm();
              } finally {
                setBusy(false);
                onClose();
              }
            }}
          >
            {busy ? 'Working…' : request.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
