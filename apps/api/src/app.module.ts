import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { FirebaseModule } from './firebase/firebase.module';
import { StorageModule } from './storage/storage.module';
import { TenantResolutionMiddleware } from './common/tenancy/tenant-resolution.middleware';
import { AuthModule } from './auth/auth.module';
import { AccessModule } from './access/access.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { EmployeesModule } from './employees/employees.module';
import { LeaveModule } from './leave/leave.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    PrismaModule,
    FirebaseModule,
    StorageModule,
    AuthModule,
    AccessModule,
    PlatformAdminModule,
    EmployeesModule,
    LeaveModule,
    AttendanceModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every tenant-facing route gets a resolved tenant attached to the
    // request BEFORE auth runs (login needs it too). Platform-admin routes
    // have no tenant concept at all; the health probe answers before auth
    // and has no tenant either — both are excluded.
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        { path: 'platform-admin/(.*)', method: RequestMethod.ALL },
        { path: 'health', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
