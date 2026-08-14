import { randomBytes } from 'crypto';
import { rename as renameFile } from 'fs/promises';
import { extname, join } from 'path';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  EMPLOYEE_DOCUMENT_CODE,
  EMPLOYEE_UPLOAD_DIR,
  EMPLOYEE_URL_PREFIX,
} from './hr-employee.constants';
import { SaveEmployeeDto } from './hr-employee.dto';

/** What a photo upload hands back from multer. */
export interface UploadedPhoto {
  originalname: string;
  mimetype: string;
  path: string;
}

/**
 * The designation carries the classification, so it is read WITH its group and
 * category — that is what lets an employee show a category and group without
 * storing either.
 */
const withRelations = {
  designation: {
    select: {
      id: true,
      code: true,
      name: true,
      ratePerHour: true,
      category: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
    },
  },
  reportsTo: { select: { id: true, code: true, name: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof withRelations }>;

/** Division and department names, looked up once per request. */
interface PostingNames {
  divisions: Map<number, string>;
  departments: Map<number, string>;
}

/**
 * Employee Master (SRS §8.9, FR-HRP-01).
 *
 * An employee is NOT a user, and that is the requirement rather than a
 * simplification: "including staff who do not have user logins". Most of the
 * bakery's staff never sign in — their managers mark their attendance and raise
 * their leave — so nothing here reaches for a User row or expects one to exist.
 *
 * Scoped to a company and a branch, both chosen ON THE FORM rather than taken
 * from the topbar picker: HR set up the whole group's staff, and making them
 * switch company to add somebody at another branch is a step that exists only
 * because the data model asked for it. The server re-checks the choice, since it
 * no longer arrives in a header the application controls.
 */
@Injectable()
export class HrEmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  // ------------------------------------------------------------------ read --

  async findAll(
    companyId: number | undefined,
    opts: { search?: string; branchId?: number; all?: boolean } = {},
  ) {
    const search = opts.search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        // The list follows the company being worked in, like every other master
        // — `all` is for the pickers that need to reach across it.
        ...(opts.all || !companyId ? {} : { companyId }),
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: withRelations,
      orderBy: { code: 'asc' },
    });
    const names = await this.postingNames();
    return rows.map((r) => this.view(r, names));
  }

  async findOne(companyId: number | undefined, id: number) {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!row) throw new NotFoundException('Employee not found');
    return this.view(row, await this.postingNames());
  }

  // ----------------------------------------------------------------- write --

  async create(
    activeCompanyId: number | undefined,
    activeBranchId: number | undefined,
    dto: SaveEmployeeDto,
  ) {
    const data = await this.fields(dto, {
      companyId: activeCompanyId,
      branchId: activeBranchId,
    });

    if (!data.name) throw new BadRequestException('Give the employee a name.');
    if (!data.photoUrl) {
      throw new BadRequestException(
        'A photograph is required — upload one before saving.',
      );
    }
    if (!data.designationId) {
      throw new BadRequestException('Choose a designation.');
    }
    if (!data.dateOfJoin) {
      throw new BadRequestException('Enter the date of joining.');
    }

    // The code comes from the company's own numbering rule (Cpanel → Document
    // Numbering, document EMPLOYEE), so HR can shape it — EK/EMP/0001 — without
    // a developer. EMP-0001 is only the fallback for a company that has
    // configured nothing.
    //
    // `attempt` offsets the sequence: the number is DERIVED (MAX + 1), so two
    // people saving at once are handed the same one, and the loser has to ask
    // for the next rather than retry the same number for ever.
    for (let attempt = 0; ; attempt++) {
      const code = await this.numbering.nextOrDefault(
        { companyId: data.companyId!, branchId: null },
        EMPLOYEE_DOCUMENT_CODE,
        { prefix: 'EMP-', padding: 4 },
        undefined,
        attempt,
      );
      try {
        const created = await this.prisma.employee.create({
          data: {
            ...(data as Prisma.EmployeeUncheckedCreateInput),
            code,
          },
          include: withRelations,
        });
        return this.view(created, await this.postingNames());
      } catch (e) {
        if (attempt < 5 && this.isDuplicate(e, 'code')) continue;
        throw this.asFriendly(e);
      }
    }
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: SaveEmployeeDto,
  ) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Employee not found');
    assertUnlocked(existing, 'employee', 'editing');

    const data = await this.fields(dto, {
      companyId: existing.companyId,
      branchId: existing.branchId ?? undefined,
      existingId: id,
    });

    // A photograph cannot be REMOVED once required — only replaced.
    if (dto.photoUrl !== undefined && !dto.photoUrl) delete data.photoUrl;

    try {
      await this.prisma.employee.update({
        where: { id },
        data: data as Prisma.EmployeeUncheckedUpdateInput,
      });
    } catch (e) {
      throw this.asFriendly(e);
    }
    return this.findOne(companyId, id);
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    await this.prisma.employee.update({
      where: { id },
      data: { isLocked: locked },
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Employee not found');
    assertUnlocked(existing, 'employee', 'deleting');

    // Somebody reports to them. Deleting would quietly cut the line of report,
    // so it is refused with the reason rather than silently nulled.
    const reports = await this.prisma.employee.count({
      where: { reportsToId: id },
    });
    if (reports) {
      throw new BadRequestException(
        `${reports} ${reports === 1 ? 'employee reports' : 'employees report'} to this one. Re-point them first.`,
      );
    }

    await this.prisma.employee.delete({ where: { id } });
    return { ok: true };
  }

  /** Store an uploaded photograph and hand back the URL to save on the row. */
  async uploadPhoto(file: UploadedPhoto): Promise<{ url: string }> {
    const extByType: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
    };
    const ext = extname(file.originalname) || extByType[file.mimetype] || '';
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await renameFile(file.path, join(EMPLOYEE_UPLOAD_DIR, name));
    return { url: `${EMPLOYEE_URL_PREFIX}/${name}` };
  }

  // ---------------------------------------------------------------- guards --

  /**
   * Normalize what was sent, merged with where it already is.
   *
   * Only keys actually present are returned, so a partial update leaves
   * everything it does not mention alone.
   */
  private async fields(
    dto: SaveEmployeeDto,
    ctx: { companyId?: number; branchId?: number; existingId?: number },
  ) {
    const companyId = dto.companyId ?? ctx.companyId;
    if (!companyId) {
      throw new BadRequestException(
        'Choose the company this employee belongs to.',
      );
    }
    // Naming a company but no branch means the company as a whole; only when
    // neither is named does the active branch stand in, since carrying it into
    // a DIFFERENT company would attach a branch that does not belong to it.
    const branchId =
      dto.branchId !== undefined
        ? dto.branchId
        : dto.companyId !== undefined
          ? null
          : (ctx.branchId ?? null);

    await this.assertPlace(companyId, branchId);
    if (dto.designationId !== undefined) {
      await this.assertDesignation(dto.designationId);
    }
    const posting = await this.posting(dto, companyId, ctx.existingId);
    if (dto.reportsToId != null) {
      await this.assertManager(dto.reportsToId, companyId, ctx.existingId);
    }

    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.dateOfBirth !== undefined
        ? { dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null }
        : {}),
      ...(dto.sex !== undefined ? { sex: dto.sex } : {}),
      ...(dto.maritalStatus !== undefined
        ? { maritalStatus: dto.maritalStatus }
        : {}),
      ...(dto.aadhaarNumber !== undefined
        ? { aadhaarNumber: dto.aadhaarNumber?.trim() || null }
        : {}),
      ...(dto.address !== undefined
        ? { address: dto.address?.trim() || null }
        : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
      ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
      ...(dto.emergencyContactName !== undefined
        ? { emergencyContactName: dto.emergencyContactName?.trim() || null }
        : {}),
      ...(dto.emergencyContactPhone !== undefined
        ? { emergencyContactPhone: dto.emergencyContactPhone?.trim() || null }
        : {}),
      ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
      companyId,
      branchId,
      ...posting,
      ...(dto.designationId !== undefined
        ? { designationId: dto.designationId }
        : {}),
      ...(dto.dateOfJoin !== undefined
        ? { dateOfJoin: new Date(dto.dateOfJoin) }
        : {}),
      ...(dto.reportsToId !== undefined
        ? { reportsToId: dto.reportsToId }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
  }

  /** The company must exist, and a named branch must belong to it. */
  private async assertPlace(companyId: number, branchId: number | null) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException('No such company.');
    if (branchId == null) return;

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException(
        'That branch does not belong to that company.',
      );
    }
  }

  private async assertDesignation(designationId: number) {
    const row = await this.prisma.hrDesignation.findUnique({
      where: { id: designationId },
      select: { id: true, isActive: true },
    });
    if (!row) throw new BadRequestException('No such designation.');
    if (!row.isActive) {
      throw new BadRequestException('That designation is inactive.');
    }
  }

  /**
   * Division and department, resolved as a PAIR and checked against the
   * company.
   *
   * They come from the company's own structure — a division is a cost centre, a
   * department the cost object under it — so the two answers have to agree, and
   * the one mistake two independent dropdowns can make is a department that
   * belongs to another division. Checking them together is what catches it.
   *
   * Moving somebody to a different division CLEARS a department that no longer
   * sits under it: the alternative is refusing an edit whose meaning is plain,
   * or keeping a pair that contradicts itself.
   *
   * Returns only the keys that should actually be written, so a request that
   * mentions neither leaves both alone.
   */
  private async posting(
    dto: SaveEmployeeDto,
    companyId: number,
    existingId?: number,
  ): Promise<{ costCenterId?: number | null; costObjectId?: number | null }> {
    if (dto.costCenterId === undefined && dto.costObjectId === undefined) {
      return {};
    }

    const existing = existingId
      ? await this.prisma.employee.findUnique({
          where: { id: existingId },
          select: { costCenterId: true, costObjectId: true },
        })
      : null;

    const costCenterId =
      dto.costCenterId !== undefined
        ? dto.costCenterId
        : (existing?.costCenterId ?? null);
    let costObjectId =
      dto.costObjectId !== undefined
        ? dto.costObjectId
        : (existing?.costObjectId ?? null);

    if (costCenterId != null) {
      const centre = await this.prisma.costCenter.findFirst({
        where: { id: costCenterId, companyId },
        select: { id: true },
      });
      if (!centre) {
        throw new BadRequestException(
          'That division does not belong to this company.',
        );
      }
    }

    if (costObjectId != null) {
      const object = await this.prisma.costObject.findFirst({
        where: { id: costObjectId, companyId },
        select: { costCenterId: true },
      });
      if (!object) {
        throw new BadRequestException(
          'That department does not belong to this company.',
        );
      }
      if (costCenterId == null) {
        // A department names its own division, so there is no reason to make
        // somebody pick it twice — it is filled in from the department.
        return { costCenterId: object.costCenterId, costObjectId };
      }
      if (object.costCenterId !== costCenterId) {
        // Only a division change the caller did not re-answer for gets the
        // department cleared; contradicting BOTH in one request is an error.
        if (dto.costObjectId !== undefined) {
          throw new BadRequestException(
            'That department is not under the chosen division.',
          );
        }
        costObjectId = null;
      }
    }

    return { costCenterId, costObjectId };
  }

  /**
   * A manager must work for the same company, and cannot be the employee
   * themselves — a line of report that loops answers to nobody.
   */
  private async assertManager(
    managerId: number,
    companyId: number,
    selfId?: number,
  ) {
    if (selfId && managerId === selfId) {
      throw new BadRequestException('Somebody cannot report to themselves.');
    }
    const manager = await this.prisma.employee.findFirst({
      where: { id: managerId, companyId },
      select: { id: true },
    });
    if (!manager) {
      throw new BadRequestException(
        'That manager does not work for this company.',
      );
    }
  }

  // ----------------------------------------------------------- view shapes --

  /**
   * Division and department names, in two queries for the whole page rather
   * than two per row.
   */
  private async postingNames(): Promise<PostingNames> {
    const [centres, objects] = await Promise.all([
      this.prisma.costCenter.findMany({ select: { id: true, name: true } }),
      this.prisma.costObject.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      divisions: new Map(centres.map((c) => [c.id, c.name])),
      departments: new Map(objects.map((o) => [o.id, o.name])),
    };
  }

  private view(row: EmployeeRow, names: PostingNames) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,

      dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sex: row.sex,
      maritalStatus: row.maritalStatus,
      aadhaarNumber: row.aadhaarNumber,
      address: row.address,
      phone: row.phone,
      email: row.email,
      emergencyContactName: row.emergencyContactName,
      emergencyContactPhone: row.emergencyContactPhone,
      photoUrl: row.photoUrl,

      companyId: row.companyId,
      branchId: row.branchId,
      /** Division = cost centre, department = the cost object under it. */
      costCenterId: row.costCenterId,
      divisionName: row.costCenterId
        ? (names.divisions.get(row.costCenterId) ?? null)
        : null,
      costObjectId: row.costObjectId,
      departmentName: row.costObjectId
        ? (names.departments.get(row.costObjectId) ?? null)
        : null,

      designationId: row.designationId,
      designationName: row.designation.name,
      /**
       * Derived, never stored: the designation already knows its group and
       * category, and a copy here would be a second thing to keep in step with
       * a designation that can be moved between groups.
       */
      groupId: row.designation.group.id,
      groupName: row.designation.group.name,
      categoryId: row.designation.category.id,
      categoryName: row.designation.category.name,
      ratePerHour: row.designation.ratePerHour,

      dateOfJoin: row.dateOfJoin.toISOString().slice(0, 10),
      reportsToId: row.reportsToId,
      reportsToName: row.reportsTo?.name ?? null,

      isActive: row.isActive,
      isLocked: row.isLocked,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private isDuplicate(e: unknown, field: string): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      String((e.meta as { target?: string[] })?.target ?? '').includes(field)
    );
  }

  /** Turn the two unique clashes that can reach a user into plain sentences. */
  private asFriendly(e: unknown): unknown {
    if (this.isDuplicate(e, 'aadhaarNumber')) {
      return new BadRequestException(
        'That Aadhaar number is already on another employee.',
      );
    }
    return e;
  }
}
