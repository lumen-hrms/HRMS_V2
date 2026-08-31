import { SetMetadata } from '@nestjs/common';

export type AppRole = 'COMPANY_ADMIN' | 'HR_MANAGER' | 'LINE_MANAGER' | 'EMPLOYEE' | 'AUDITOR';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
