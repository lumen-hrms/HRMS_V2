import { IsIn, IsInt, Min } from 'class-validator';

const WIZARD_STATUSES = ['PENDING', 'IN_PROGRESS', 'DISMISSED', 'COMPLETED'] as const;

/** `PATCH /api/tenant-config/wizard` */
export class UpdateWizardStateDto {
  @IsIn(WIZARD_STATUSES)
  status!: (typeof WIZARD_STATUSES)[number];

  @IsInt()
  @Min(0)
  step!: number;
}
