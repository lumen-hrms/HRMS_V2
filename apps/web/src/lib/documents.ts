import * as React from 'react';
import { api, isApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

/**
 * Shared bits for module 09 (Documents) — every uploaded file is
 * `PENDING_SCAN` until the server's malware scan clears it, and only a
 * `CLEAN` file can be downloaded (docs/modules/09_DOCUMENTS.md §3).
 * `UNSCANNED` is what the API reports instead of `PENDING_SCAN`/`SCAN_FAILED`
 * when the deployment has `DOCUMENT_SCANNING_ENABLED=false` (no clamd): the
 * file was never scanned, and is downloadable.
 */
export type ScanStatus = 'PENDING_SCAN' | 'CLEAN' | 'INFECTED' | 'SCAN_FAILED' | 'UNSCANNED';

/** Only a scanned-clean file, or one from a scan-disabled deployment, can be opened. */
export function canDownload(status: ScanStatus): boolean {
  return status === 'CLEAN' || status === 'UNSCANNED';
}

export interface DocumentRef {
  id: string;
  label: string;
  scanStatus: ScanStatus;
}

/** `accept` for every upload input — mirrors the server's allow-list (PDF/JPG/PNG, 10 MB). */
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Client-side pre-check so the user hears about a bad file before it uploads; the server re-checks. */
export function uploadProblem(file: File): string | null {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
    return 'Only PDF, JPG or PNG files can be uploaded.';
  }
  if (file.size > MAX_UPLOAD_BYTES) return 'File exceeds the 10 MB limit.';
  return null;
}

/** Fetches a 5-minute presigned URL and opens it; the browser saves the file (attachment disposition). */
export function useOpenDocument() {
  const { toast } = useToast();
  return React.useCallback(
    async (documentId: string) => {
      try {
        const { url } = await api.get<{ url: string }>(`/documents/${documentId}/download-url`);
        window.open(url, '_blank', 'noopener');
      } catch (err) {
        toast({
          title: 'Could not open file',
          description: isApiError(err) ? err.message : undefined,
          tone: 'error',
        });
      }
    },
    [toast],
  );
}
