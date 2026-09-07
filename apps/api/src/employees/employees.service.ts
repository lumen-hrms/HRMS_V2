import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import type * as admin from 'firebase-admin';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { CreateDepartmentDto, CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

/**
 * "Own reports only" (Line Manager) / "own data only" (Employee) scoping,
 * applied on top of whatever RLS already restricted to this tenant. RLS
 * guarantees tenant isolation; this is ordinary service-layer authorization
 * within a tenant, same as any single-tenant app would need.
 */
function scopeFor(user: AuthenticatedUser): Prisma.EmployeeWhereInput {
  switch (user.role) {
    case 'EMPLOYEE':
      return { id: user.employeeId ?? '__none__' };
    case 'LINE_MANAGER':
      return {
        OR: [
          { id: user.employeeId ?? '__none__' },
          { reportingManagerId: user.employeeId ?? '__none__' },
        ],
      };
    default:
      return {};
  }
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  // ---- Departments ----

  listDepartments() {
    return this.tenantPrisma.client.department.findMany({ orderBy: { name: 'asc' } });
  }

  createDepartment(dto: CreateDepartmentDto) {
    return this.tenantPrisma.client.department.create({
      data: { tenantId: this.tenantPrisma.tenantId, name: dto.name },
    });
  }

  // ---- Employees ----

  async list(user: AuthenticatedUser) {
    return this.tenantPrisma.client.employee.findMany({
      where: scopeFor(user),
      include: { department: true, reportingManager: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async get(id: string, user: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { id, ...scopeFor(user) },
      include: { department: true, reportingManager: true, directReports: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(dto: CreateEmployeeDto) {
    const tenantId = this.tenantPrisma.tenantId;

    // Firebase user creation is a network call to the Admin SDK, not a DB
    // write — do it before the transaction rather than inside it, same
    // pattern as PlatformAdminService.seedCompanyAdmin.
    let pendingUser: { email: string; firebaseUid: string; role: string } | undefined;
    if (dto.loginEmail && dto.loginTempPassword) {
      const role = (dto.loginRole as string) ?? 'EMPLOYEE';
      let firebaseUid: string;
      try {
        const created = await this.firebaseAuth.createUser({
          email: dto.loginEmail,
          password: dto.loginTempPassword,
        });
        firebaseUid = created.uid;
      } catch (err: any) {
        if (err?.code === 'auth/email-already-exists') {
          throw new BadRequestException('That login email is already registered with Firebase');
        }
        throw err;
      }
      await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role });
      pendingUser = { email: dto.loginEmail, firebaseUid, role };
    }

    return this.tenantPrisma.client.$transaction(async (tx) => {
      let userId: string | undefined;
      if (pendingUser) {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: pendingUser.email,
            firebaseUid: pendingUser.firebaseUid,
            role: pendingUser.role as any,
          },
        });
        userId = user.id;
      }

      return tx.employee.create({
        data: {
          tenantId,
          userId,
          employeeCode: dto.employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          personalEmail: dto.personalEmail,
          phone: dto.phone,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
          departmentId: dto.departmentId,
          designation: dto.designation,
          dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
          reportingManagerId: dto.reportingManagerId,
        },
      });
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, user: AuthenticatedUser) {
    await this.get(id, user); // 404 / scope check
    if (dto.reportingManagerId === id) {
      throw new BadRequestException('An employee cannot be their own reporting manager');
    }
    return this.tenantPrisma.client.employee.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: undefined,
        employmentStatus: dto.employmentStatus as any,
      },
    });
  }

  /** Org hierarchy: everyone at the tenant, shaped as a manager -> reports tree. */
  async orgChart() {
    const employees = await this.tenantPrisma.client.employee.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        reportingManagerId: true,
      },
    });
    const byId = new Map(employees.map((e) => [e.id, { ...e, directReports: [] as any[] }]));
    const roots: any[] = [];
    for (const e of byId.values()) {
      if (e.reportingManagerId && byId.has(e.reportingManagerId)) {
        byId.get(e.reportingManagerId)!.directReports.push(e);
      } else {
        roots.push(e);
      }
    }
    return roots;
  }

  // ---- Documents ----

  async uploadDocument(employeeId: string, file: Express.Multer.File, label: string) {
    const tenantId = this.tenantPrisma.tenantId;
    const key = this.storage.buildKey(tenantId, employeeId, file.originalname);
    await this.storage.upload(key, file.buffer, file.mimetype);
    return this.tenantPrisma.client.document.create({
      data: {
        tenantId,
        employeeId,
        label,
        storageKey: key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async listDocuments(employeeId: string) {
    return this.tenantPrisma.client.document.findMany({ where: { employeeId } });
  }

  async getDocumentDownloadUrl(documentId: string) {
    const doc = await this.tenantPrisma.client.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    const url = await this.storage.getPresignedDownloadUrl(doc.storageKey);
    return { url, expiresInSeconds: 300 };
  }

  // ---- Bulk import ----

  async bulkImport(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Workbook has no sheets');

    const header = (sheet.getRow(1).values as any[]).map((v) => String(v ?? '').trim());
    const col = (name: string) => header.indexOf(name);

    const required = ['employeeCode', 'firstName', 'lastName'];
    for (const r of required) {
      if (col(r) === -1) throw new BadRequestException(`Missing required column: ${r}`);
    }

    const results: { row: number; success: boolean; error?: string }[] = [];
    const tenantId = this.tenantPrisma.tenantId;

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      if (row.values === undefined || (row.values as any[]).length === 0) continue;

      const get = (name: string) => {
        const idx = col(name);
        return idx === -1 ? undefined : row.getCell(idx).text?.trim() || undefined;
      };

      try {
        const employeeCode = get('employeeCode');
        const firstName = get('firstName');
        const lastName = get('lastName');
        if (!employeeCode || !firstName || !lastName) {
          throw new Error('employeeCode, firstName and lastName are required');
        }

        await this.tenantPrisma.client.employee.create({
          data: {
            tenantId,
            employeeCode,
            firstName,
            lastName,
            personalEmail: get('personalEmail'),
            phone: get('phone'),
            designation: get('designation'),
          },
        });
        results.push({ row: rowNum, success: true });
      } catch (err: any) {
        results.push({ row: rowNum, success: false, error: err.message ?? 'Unknown error' });
      }
    }

    return {
      totalRows: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
