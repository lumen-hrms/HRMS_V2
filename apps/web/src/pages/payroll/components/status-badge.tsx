import { Badge } from '@/components/ui/badge';
import type { PayrollRunStatus, FullAndFinalStatus } from '@/lib/payroll/types';

const RUN_VARIANT: Record<PayrollRunStatus, 'default' | 'warning' | 'success' | 'outline'> = {
  DRAFT: 'default',
  REVIEW: 'warning',
  APPROVED: 'outline',
  PROCESSED: 'success',
  DISBURSED: 'success',
};

/** §3.6: Run status -> chip colour. PROCESSED/DISBURSED both success; the page adds a lock icon for PROCESSED. */
export function RunStatusBadge({ status }: { status: PayrollRunStatus }) {
  return <Badge variant={RUN_VARIANT[status]}>{status}</Badge>;
}

export function StructureStatusBadge({ status }: { status: 'ACTIVE' | 'SUPERSEDED' }) {
  return <Badge variant={status === 'ACTIVE' ? 'success' : 'default'}>{status}</Badge>;
}

const FNF_VARIANT: Record<FullAndFinalStatus, 'default' | 'outline' | 'success'> = {
  DRAFT: 'default',
  APPROVED: 'outline',
  PAID: 'success',
};

export function FnfStatusBadge({ status }: { status: FullAndFinalStatus }) {
  return <Badge variant={FNF_VARIANT[status]}>{status}</Badge>;
}
