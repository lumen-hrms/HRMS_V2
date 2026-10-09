import { IsIn, IsOptional, Matches } from 'class-validator';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportQueryDto {
  @IsOptional()
  @Matches(ISO_DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Matches(ISO_DAY, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period?: string;
}

export class ReportExportQueryDto extends ReportQueryDto {
  @IsIn(['csv', 'xlsx'])
  format!: 'csv' | 'xlsx';
}
