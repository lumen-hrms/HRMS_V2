import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PlatformPrismaClientProvider } from '../../prisma/platform-prisma-client.provider';
import type { AppConfig } from '../../config/configuration';

export interface TenantResolvedRequest extends Request {
  tenantId?: string;
  tenantSubdomain?: string;
  tenantStatus?: string;
}

/**
 * Resolves which tenant a request belongs to, BEFORE authentication runs.
 * This has to happen pre-auth because the login endpoint itself needs to
 * know which tenant's `users` table to look in.
 *
 * Production: subdomain of the Host header (acme.hrms-platform.com -> acme).
 * Local dev: an `X-Tenant-Subdomain` header, which is trivial to set from
 * curl/Postman/the SPA dev server without wiring up real DNS/hosts entries.
 *
 * The resolved tenant id is looked up from `platform.tenants` using the
 * platform DB role — this is the ONE place tenant metadata is read for
 * routing purposes; it never touches tenant business tables.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async use(req: TenantResolvedRequest, _res: Response, next: NextFunction) {
    const subdomain = this.extractSubdomain(req);

    if (!subdomain) {
      throw new NotFoundException('No tenant could be resolved for this request');
    }

    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true, subdomain: true, status: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Unknown tenant: ${subdomain}`);
    }
    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('This tenant account has been suspended');
    }

    req.tenantId = tenant.id;
    req.tenantSubdomain = tenant.subdomain;
    req.tenantStatus = tenant.status;
    next();
  }

  private extractSubdomain(req: Request): string | null {
    const mode = this.config.get('tenantResolutionMode', { infer: true });

    if (mode === 'header') {
      const header = req.header('x-tenant-subdomain');
      return header ? header.toLowerCase().trim() : null;
    }

    // subdomain mode: parse from Host header, e.g. "acme.hrms-platform.com"
    const host = req.header('host') ?? '';
    const parts = host.split('.');
    if (parts.length < 3) return null; // no subdomain present
    return parts[0].toLowerCase().trim();
  }
}
