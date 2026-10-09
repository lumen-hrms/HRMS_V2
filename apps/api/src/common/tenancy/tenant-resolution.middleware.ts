import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PlatformPrismaClientProvider } from '../../prisma/platform-prisma-client.provider';
import type { AppConfig } from '../../config/configuration';

export interface TenantResolvedRequest extends Request {
  tenantId?: string;
  tenantSubdomain?: string;
  tenantName?: string;
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
/** Sign-in must keep working on a read-only tenant so users can still read their data. */
const READ_ONLY_EXEMPT_PATHS = ['/api/auth/session'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when a request to a READ_ONLY tenant must be refused: any write
 * method, except the sign-in exchange. Reads (GET/HEAD/OPTIONS) always pass.
 */
export function isWriteToReadOnlyBlocked(method: string, url: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const path = url.split('?')[0];
  return !READ_ONLY_EXEMPT_PATHS.includes(path);
}

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
      select: { id: true, subdomain: true, name: true, status: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Unknown tenant: ${subdomain}`);
    }
    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('This tenant account has been suspended');
    }
    if (tenant.status === 'READ_ONLY' && isWriteToReadOnlyBlocked(req.method, req.originalUrl)) {
      throw new ForbiddenException(
        'This workspace is read-only because its trial has ended. Contact your administrator to subscribe.',
      );
    }

    req.tenantId = tenant.id;
    req.tenantSubdomain = tenant.subdomain;
    req.tenantName = tenant.name;
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
