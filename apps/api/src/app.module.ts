import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { TenantResolutionMiddleware } from './common/tenancy/tenant-resolution.middleware';
import { AuthModule } from './auth/auth.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { EmployeesModule } from './employees/employees.module';
import { LeaveModule } from './leave/leave.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    StorageModule,
    AuthModule,
    PlatformAdminModule,
    EmployeesModule,
    LeaveModule,
    DashboardModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every tenant-facing route gets a resolved tenant attached to the
    // request BEFORE auth runs (login needs it too). Platform-admin routes
    // have no tenant concept at all and are excluded.
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude({ path: 'platform-admin/(.*)', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
