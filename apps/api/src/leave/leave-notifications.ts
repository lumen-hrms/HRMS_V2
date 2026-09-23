import type { Prisma } from '@prisma/client';
import type { LeaveContext } from '../notifications/templates';

/** The email context (module 10) for one leave request — shared by LeaveService and the escalation processor. */
export function leaveNotificationContext(row: {
  id: string;
  startDate: Date;
  endDate: Date;
  days: Prisma.Decimal | number;
  reason: string | null;
  employee: { firstName: string; lastName: string };
  leaveType: { name: string };
}): LeaveContext {
  return {
    requestId: row.id,
    applicantName: `${row.employee.firstName} ${row.employee.lastName}`,
    leaveTypeName: row.leaveType.name,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    days: Number(row.days),
    reason: row.reason,
  };
}
