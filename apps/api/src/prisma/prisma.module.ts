import { Global, Module } from '@nestjs/common';
import { TenantPrismaClientProvider } from './tenant-prisma-client.provider';
import { PlatformPrismaClientProvider } from './platform-prisma-client.provider';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  providers: [TenantPrismaClientProvider, PlatformPrismaClientProvider, TenantPrismaService],
  exports: [TenantPrismaClientProvider, PlatformPrismaClientProvider, TenantPrismaService],
})
export class PrismaModule {}
