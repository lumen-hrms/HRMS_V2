import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * `@Global()` — `AuditService` wraps `TenantPrismaService` (itself global)
 * with nothing tenant-request-specific of its own, so every module that
 * writes to `audit_log` (access, employees, attendance, …) injects it
 * directly without adding `AuditModule` to its own `imports`.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
