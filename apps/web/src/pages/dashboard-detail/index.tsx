import * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { HeadcountDetail, OnLeaveDetail, PendingApprovalsDetail, PresentTodayDetail } from './admin-metrics';
import { AttendanceDetail, LeaveBalanceDetail, OvertimeDetail, PunctualityDetail } from './employee-metrics';

/** `/dashboard/:metric` — the page behind a dashboard tile. Which metrics exist depends on the dashboard the role sees. */
const ADMIN_METRICS: Record<string, React.ComponentType> = {
  headcount: HeadcountDetail,
  'present-today': PresentTodayDetail,
  'on-leave': OnLeaveDetail,
  'pending-approvals': PendingApprovalsDetail,
};

const EMPLOYEE_METRICS: Record<string, React.ComponentType> = {
  attendance: AttendanceDetail,
  punctuality: PunctualityDetail,
  overtime: OvertimeDetail,
  'leave-balance': LeaveBalanceDetail,
};

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

export function DashboardDetailPage() {
  const { metric = '' } = useParams();
  const { user } = useAuth();
  if (!user) return null;
  const metrics = ADMIN_ROLES.includes(user.role) ? ADMIN_METRICS : EMPLOYEE_METRICS;
  const Page = Object.hasOwn(metrics, metric) ? metrics[metric] : null;
  return Page ? <Page /> : <Navigate to="/" replace />;
}
