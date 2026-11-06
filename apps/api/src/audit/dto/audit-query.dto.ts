import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** GET /api/audit — the cross-module aggregation feed (module 12). */
export class AuditQueryDto {
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  from?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  to?: string; // YYYY-MM-DD

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

/** Only real filter values reach AuditService.query — 'ALL' from the frontend selects means "no filter". */
export function normalizeAuditFilter(dto: AuditQueryDto) {
  return {
    module: dto.module && dto.module !== 'ALL' ? dto.module : undefined,
    action: dto.action && dto.action !== 'ALL' ? dto.action : undefined,
    targetType: dto.targetType && dto.targetType !== 'ALL' ? dto.targetType : undefined,
    q: dto.q || undefined,
    from: dto.from || undefined,
    to: dto.to || undefined,
    limit: dto.limit,
  };
}
