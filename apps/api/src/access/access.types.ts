import type { LoginOutcome } from '@prisma/client';
import type { AppRole } from '../common/decorators/roles.decorator';
import type { FrontendAuditAction } from './access.support';

/**
 * API response shapes for the Identity & Access module. Kept byte-compatible
 * with the frontend contract in `apps/web/src/lib/access/types.ts` — when
 * `packages/shared-types` starts carrying real DTOs these move there and
 * both sides re-export them.
 */

export interface AccessUserDto {
  id: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    designation: string;
    department: string | null;
  } | null;
  firebaseUid: string;
  firebaseDisabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastLoginDevice: string | null;
}

export type MeDto = AccessUserDto & { tenantName: string };

export interface LoginAuditEntryDto {
  id: string;
  at: string;
  email: string;
  userId: string | null;
  outcome: LoginOutcome;
  ip: string;
  userAgent: string;
  deviceLabel: string | null;
}

export interface AccessAuditEntryDto {
  id: string;
  at: string;
  actorName: string;
  actorRole: AppRole;
  action: FrontendAuditAction;
  targetEmail: string;
  before: string | null;
  after: string | null;
  note: string | null;
}

export interface ActivityItemDto {
  kind: 'login' | 'access';
  at: string;
  label: string;
  detail: string;
}
