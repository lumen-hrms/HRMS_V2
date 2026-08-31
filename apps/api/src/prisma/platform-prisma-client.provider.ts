import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/configuration';

/**
 * The single long-lived PostgreSQL connection pool used by the
 * platform-admin module ONLY (tenant provisioning, plan/status management).
 *
 * This connects as the `hrms_platform` role, which has zero grants on the
 * `public` schema — it is architecturally incapable of reading or writing
 * employee/leave/payroll data, regardless of what application code asks it
 * to do. See tenant-isolation.e2e-spec.ts for a test that proves this by
 * attempting a raw query against `public.employees` with this connection
 * and asserting Postgres rejects it.
 */
@Injectable()
export class PlatformPrismaClientProvider
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      datasources: {
        db: { url: config.get('db.platformUrl', { infer: true }) },
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
