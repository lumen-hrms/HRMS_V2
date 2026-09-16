import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { AppRole } from '../../common/decorators/roles.decorator';

const ASSIGNABLE_ROLES: AppRole[] = [
  'COMPANY_ADMIN',
  'HR_MANAGER',
  'LINE_MANAGER',
  'EMPLOYEE',
  'AUDITOR',
];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** PATCH /api/access/users/:id/role */
export class ChangeRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  newRole!: AppRole;

  // Audit reason — required, min 5 chars after trimming (module 01 §5.4).
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'A reason of at least 5 characters is required.' })
  reason!: string;
}

/** PATCH /api/access/users/:id/status */
export class SetUserStatusDto {
  @IsBoolean()
  isActive!: boolean;

  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'A reason of at least 5 characters is required.' })
  reason!: string;
}

/** GET /api/access/audit?feed=login|access&... */
export class AuditQueryDto {
  @IsIn(['login', 'access'])
  feed!: 'login' | 'access';

  // feed=login only
  @IsOptional()
  @IsIn(['SUCCESS', 'USER_INACTIVE', 'CLAIM_MISMATCH', 'TOKEN_EXPIRED', 'ALL'])
  outcome?: string;

  // feed=access only — the frontend's dotted action name (types.ts AccessAuditAction).
  @IsOptional()
  @IsIn([
    'role.changed',
    'user.activated',
    'user.deactivated',
    'password_reset.sent',
    'user.created',
    'ALL',
  ])
  action?: string;

  @IsOptional()
  @IsString()
  from?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  to?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  q?: string;
}
