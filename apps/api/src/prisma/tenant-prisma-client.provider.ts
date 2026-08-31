import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/configuration';

/**
 * The single long-lived PostgreSQL connection pool used for ALL tenant
 * business-data queries (employees, leave, departments, ...).
 *
 * This connects as the `hrms_app` role, which:
 *   - has no BYPASSRLS, so every query is subject to the tenant_isolation
 *     RLS policies created in the roles_and_rls migration
 *   - has zero grants on the `platform` schema
 *
 * Nothing outside `TenantPrismaService` (request-scoped) should import this
 * directly — always go through `TenantPrismaService.client`, which sets the
 * `app.current_tenant_id` session variable before every query.
 */
@Injectable()
export class TenantPrismaClientProvider
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      datasources: {
        db: { url: config.get('db.tenantUrl', { infer: true }) },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
