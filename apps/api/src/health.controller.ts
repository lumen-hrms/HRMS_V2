import { Controller, Get } from '@nestjs/common';

/**
 * Unauthenticated liveness probe for load balancers / uptime checks
 * (`GET /api/health`). Deliberately excluded from `TenantResolutionMiddleware`
 * in `AppModule` — it has no tenant context and must answer before auth.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
