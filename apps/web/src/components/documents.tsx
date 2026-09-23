import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useOpenDocument, type DocumentRef, type ScanStatus } from '@/lib/documents';

/** Nothing for CLEAN; a warning/destructive badge otherwise (module 09). */
export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  if (status === 'CLEAN') return null;
  if (status === 'INFECTED') return <Badge variant="destructive">Blocked — malware detected</Badge>;
  return <Badge variant="warning">Scanning…</Badge>;
}

/** Inline paperclip link for an attachment; not clickable until the file is CLEAN. */
export function DocumentLink({ doc }: { doc: DocumentRef }) {
  const open = useOpenDocument();
  const clean = doc.scanStatus === 'CLEAN';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={!clean}
        onClick={() => open(doc.id)}
        className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {doc.label}
      </button>
      <ScanStatusBadge status={doc.scanStatus} />
    </span>
  );
}
