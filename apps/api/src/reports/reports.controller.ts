import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import { ReportKind, ReportsService, REPORT_KINDS } from './reports.service';
import { toCsv, toXlsx } from './report-export';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('COMPANY_ADMIN', 'HR_MANAGER')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':report')
  get(@Param('report') report: string, @Query() query: ReportQueryDto) {
    return this.reports.run(report, query);
  }

  @Get(':report/export')
  async export(@Param('report') report: string, @Query() query: ReportExportQueryDto) {
    if (!(REPORT_KINDS as readonly string[]).includes(report)) {
      throw new BadRequestException(`Unknown report "${report}"`);
    }
    const { table } = await this.reports.run(report, query);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${report}-${stamp}`;
    if (query.format === 'csv') {
      return new StreamableFile(Buffer.from(toCsv(table), 'utf8'), {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${name}.csv"`,
      });
    }
    const buffer = await toXlsx(table, report as ReportKind);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${name}.xlsx"`,
    });
  }
}
