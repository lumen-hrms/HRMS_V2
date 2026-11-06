import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { FieldEncryptionService, maskBankAccount } from '../crypto/field-encryption.service';
import { writePayrollAudit } from './payroll-audit';
import {
  BANK_FORMATS,
  findBankFormat,
  type BankFileContext,
  type BankFileRow,
} from './bank-file-generator';
import {
  COMPANY_BANKS,
  expectedPrefix,
  ifscPrefix,
  resolvePaymentMode,
  bankNameFromIfsc,
  type PaymentMode,
  type PreferredMode,
} from './bank-codes';
import { cleanBeneficiaryName, validateBankRow } from './bank-row-validation';
import type { SaveBankConfigDto } from './dto/payroll.dto';

const MANAGE_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

export interface LeftOutEmployee {
  employeeId: string;
  name: string;
  employeeCode: string;
  reason: 'MISSING_BANK_DETAILS' | 'INVALID_DETAILS';
  problems: string[];
}

/**
 * The payroll bank advice file: the company's own bank settings, the list of
 * formats, a pre-download check, and the file itself. The app never moves
 * money — this only shapes the file an admin uploads to their bank.
 */
@Injectable()
export class PayrollBankService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  private assertCanManage(user: AuthenticatedUser) {
    if (!MANAGE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Not authorized to manage payroll bank details');
    }
  }

  // ---- Company bank settings ----

  async getConfig() {
    const row = await this.db.payrollBankConfig.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    return {
      banks: COMPANY_BANKS,
      config: row
        ? {
            bankCode: row.bankCode,
            accountHolderName: row.accountHolderName,
            accountMasked: row.accountMasked,
            ifsc: row.ifsc,
            bankName: row.bankName,
            branch: row.branch,
            defaultPaymentMode: row.defaultPaymentMode as PreferredMode,
            updatedAt: row.updatedAt,
          }
        : null,
    };
  }

  async saveConfig(dto: SaveBankConfigDto, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const tenantId = this.tenantPrisma.tenantId;
    const existing = await this.db.payrollBankConfig.findUnique({ where: { tenantId } });
    if (!existing && !dto.accountNumber) {
      throw new BadRequestException('Enter the account number salaries are paid from');
    }
    const want = expectedPrefix(dto.bankCode);
    if (want && ifscPrefix(dto.ifsc) !== want) {
      const label = COMPANY_BANKS.find((b) => b.code === dto.bankCode)?.label;
      throw new BadRequestException(
        `This IFSC doesn’t belong to ${label} (it should start with ${want})`,
      );
    }
    const data = {
      bankCode: dto.bankCode,
      accountHolderName: dto.accountHolderName.trim(),
      ifsc: dto.ifsc.trim().toUpperCase(),
      bankName: dto.bankName?.trim() || null,
      branch: dto.branch?.trim() || null,
      defaultPaymentMode: dto.defaultPaymentMode,
      // The number is only replaced when one is sent; otherwise the stored one stays.
      ...(dto.accountNumber
        ? {
            accountCiphertext: this.fieldEncryption.encrypt(dto.accountNumber),
            accountMasked: maskBankAccount(dto.accountNumber),
          }
        : {}),
    };
    await this.db.payrollBankConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...data,
        accountCiphertext: data.accountCiphertext!,
        accountMasked: data.accountMasked!,
      },
      update: data,
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.bank_config_updated',
      'payroll_bank_config',
      undefined,
      {
        bankCode: dto.bankCode,
        accountChanged: !!dto.accountNumber,
      },
    );
    return this.getConfig();
  }

  listFormats() {
    return BANK_FORMATS.map((f) => ({
      id: f.id,
      label: f.label,
      bankCode: f.bankCode,
      version: f.version,
      available: !!f.generator,
    }));
  }

  // ---- The file ----

  private async collect(runId: string, formatId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.db.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'PROCESSED' && run.status !== 'DISBURSED') {
      throw new ConflictException('The bank file is only available once a run is PROCESSED');
    }
    const format = findBankFormat(formatId);
    if (!format) throw new BadRequestException(`Unknown bank format "${formatId}"`);

    const [configRow, lineItems] = await Promise.all([
      this.db.payrollBankConfig.findUnique({ where: { tenantId: this.tenantPrisma.tenantId } }),
      this.db.payrollLineItem.findMany({
        where: { runId },
        select: { employeeId: true, netPay: true },
      }),
    ]);
    const employees = await this.db.employee.findMany({
      where: { id: { in: lineItems.map((li) => li.employeeId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        bankAccountCiphertext: true,
        bankIfsc: true,
        bankName: true,
      },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    const preferred = (configRow?.defaultPaymentMode ?? 'NEFT') as PreferredMode;
    const rows: BankFileRow[] = [];
    const leftOut: LeftOutEmployee[] = [];
    for (const item of lineItems) {
      const e = byId.get(item.employeeId);
      if (!e) continue;
      const fullName = `${e.firstName} ${e.lastName}`;
      const amount = item.netPay.toNumber();
      const account = e.bankAccountCiphertext
        ? this.fieldEncryption.decrypt(e.bankAccountCiphertext)
        : null;
      const problems = validateBankRow({
        accountNumber: account,
        ifsc: e.bankIfsc,
        name: fullName,
        amount,
      });
      if (problems.length > 0) {
        leftOut.push({
          employeeId: e.id,
          name: fullName,
          employeeCode: e.employeeCode,
          reason: problems.some((p) => p.kind === 'MISSING')
            ? 'MISSING_BANK_DETAILS'
            : 'INVALID_DETAILS',
          problems: problems.map((p) => p.message),
        });
        continue;
      }
      const ifsc = e.bankIfsc!.trim().toUpperCase();
      rows.push({
        employeeId: e.id,
        employeeName: cleanBeneficiaryName(fullName),
        employeeCode: e.employeeCode,
        accountNumber: account!,
        ifsc,
        bankName: e.bankName ?? bankNameFromIfsc(ifsc),
        amount,
        paymentMode: resolvePaymentMode(configRow?.ifsc ?? null, ifsc, amount, preferred),
      });
    }

    const total = rows.reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const byMode = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const r of rows) {
      const cur = byMode.get(r.paymentMode!) ?? { count: 0, total: new Prisma.Decimal(0) };
      byMode.set(r.paymentMode!, { count: cur.count + 1, total: cur.total.plus(r.amount) });
    }

    const warnings: string[] = [];
    if (!configRow) {
      warnings.push(
        'Your company’s bank isn’t set up (Payroll → Settings → Bank). Every row is treated as a transfer to another bank.',
      );
    } else if (format.bankCode && format.bankCode !== configRow.bankCode) {
      warnings.push(
        `This file is in ${format.label}’s layout, but the account salaries are paid from is set to ${configRow.bankCode}.`,
      );
    }
    if (!format.generator) {
      warnings.push(
        `The ${format.label} layout isn’t available yet — use the Generic CSV for now.`,
      );
    }

    return {
      run,
      format,
      configRow,
      rows,
      leftOut,
      total,
      byMode,
      warnings,
      paid: lineItems.length,
    };
  }

  private summarise(c: Awaited<ReturnType<PayrollBankService['collect']>>) {
    return {
      period: c.run.period,
      format: {
        id: c.format.id,
        label: c.format.label,
        version: c.format.version,
        available: !!c.format.generator,
      },
      company: c.configRow
        ? {
            bankCode: c.configRow.bankCode,
            accountMasked: c.configRow.accountMasked,
            ifsc: c.configRow.ifsc,
          }
        : null,
      counts: { paid: c.paid, included: c.rows.length, leftOut: c.leftOut.length },
      total: c.total.toFixed(2),
      byMode: [...c.byMode.entries()].map(([mode, v]) => ({
        mode: mode as PaymentMode,
        count: v.count,
        total: v.total.toFixed(2),
      })),
      leftOut: c.leftOut,
      warnings: c.warnings,
    };
  }

  async preview(runId: string, formatId: string, user: AuthenticatedUser) {
    return this.summarise(await this.collect(runId, formatId, user));
  }

  async generate(runId: string, formatId: string, user: AuthenticatedUser) {
    const c = await this.collect(runId, formatId, user);
    if (!c.format.generator) {
      throw new BadRequestException(
        `The ${c.format.label} layout isn’t available yet — only ${BANK_FORMATS.filter(
          (f) => f.generator,
        )
          .map((f) => f.id)
          .join(', ')} can be downloaded`,
      );
    }
    const context: BankFileContext = {
      period: c.run.period,
      company: c.configRow
        ? {
            accountHolderName: c.configRow.accountHolderName,
            accountNumber: this.fieldEncryption.decrypt(c.configRow.accountCiphertext),
            ifsc: c.configRow.ifsc,
            bankName: c.configRow.bankName,
          }
        : null,
    };
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.bank_file_generated',
      'payroll_run',
      runId,
      {
        format: c.format.id,
        formatVersion: c.format.version,
        rowCount: c.rows.length,
        skippedCount: c.leftOut.length,
      },
    );
    return {
      filename: c.format.generator.filename(c.run.period),
      mimeType: c.format.generator.mimeType,
      content: c.format.generator.generate(c.rows, context),
      skippedEmployeeCount: c.leftOut.length,
      summary: this.summarise(c),
    };
  }
}
