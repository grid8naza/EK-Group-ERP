import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ATTENDANCE_TYPE_LOOKUP,
  FALLBACK_TIME_IN,
  FALLBACK_TIME_OUT,
  TYPE_HOLIDAY,
  TYPE_PRESENT,
  TYPE_WEEKLY_OFF,
} from './attendance.constants';
import { SaveAttendanceSettingDto, SaveHolidayDto } from './attendance.dto';

/** The working day that applies somewhere, once the levels have been resolved. */
export interface EffectiveDefaults {
  defaultTimeIn: number;
  defaultTimeOut: number;
  defaultTypeId: number | null;
  weeklyOffDays: number[];
  /** True where these came from a branch's own row rather than the company's. */
  fromBranch: boolean;
}

/** The ATTENDANCE_TYPE values, by their stable code. */
export interface TypeIds {
  present: number | null;
  weeklyOff: number | null;
  holiday: number | null;
  /** Every value in the lookup, for validating what a sheet was marked with. */
  all: Set<number>;
}

/**
 * The rules a fresh attendance sheet is filled in from: the working day, the
 * weekly off, and the dated holidays.
 *
 * Two levels, company and branch, and the branch wins. Not three: a setting per
 * employee would be a roster, and a bakery has a shift rather than two hundred
 * of them — the handful who genuinely differ carry an override on their own
 * record, which the sheet applies on top of whatever is decided here.
 */
@Injectable()
export class AttendanceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- read --

  /**
   * Every row a company keeps — its own, and one per branch that differs.
   *
   * Returned as a list rather than as the resolved answer, because the screen
   * that edits them has to show which level each came from: a branch showing
   * 09:00 because that is its own rule and a branch showing 09:00 because it
   * has no rule are different things to whoever is about to change one.
   */
  async findAll(companyId: number | undefined) {
    if (!companyId) return [];
    return this.prisma.attendanceSetting.findMany({
      where: { companyId },
      orderBy: [{ branchId: 'asc' }],
    });
  }

  /**
   * The working day in force for one branch — its own row, else the company's,
   * else a plain nine-to-six so a sheet can be marked before anybody has been
   * near the settings screen.
   */
  async effective(
    companyId: number,
    branchId: number | null,
  ): Promise<EffectiveDefaults> {
    const rows = await this.prisma.attendanceSetting.findMany({
      where: {
        companyId,
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
    });
    const own = branchId
      ? rows.find((r) => r.branchId === branchId)
      : undefined;
    const company = rows.find((r) => r.branchId === null);
    const row = own ?? company;
    if (!row) {
      const types = await this.typeIds();
      return {
        defaultTimeIn: FALLBACK_TIME_IN,
        defaultTimeOut: FALLBACK_TIME_OUT,
        defaultTypeId: types.present,
        weeklyOffDays: [],
        fromBranch: false,
      };
    }
    return {
      defaultTimeIn: row.defaultTimeIn,
      defaultTimeOut: row.defaultTimeOut,
      defaultTypeId: row.defaultTypeId ?? (await this.typeIds()).present,
      weeklyOffDays: row.weeklyOffDays,
      fromBranch: !!own,
    };
  }

  /**
   * The three type ids the system works out for itself, plus the whole set.
   *
   * Looked up by CODE rather than by label: the codes are stable and the labels
   * are the business's to rename, so a company that calls the weekly off
   * "Rest Day" still gets one pre-filled.
   */
  async typeIds(): Promise<TypeIds> {
    const values = await this.prisma.lookupValue.findMany({
      where: { lookup: { code: ATTENDANCE_TYPE_LOOKUP } },
      select: { id: true, value: true },
    });
    const byCode = new Map(values.map((v) => [v.value, v.id]));
    return {
      present: byCode.get(TYPE_PRESENT) ?? null,
      weeklyOff: byCode.get(TYPE_WEEKLY_OFF) ?? null,
      holiday: byCode.get(TYPE_HOLIDAY) ?? null,
      all: new Set(values.map((v) => v.id)),
    };
  }

  // --------------------------------------------------------------- write --

  /**
   * Save the company's row, or one branch's.
   *
   * Upserted on (company, branch) rather than created and edited separately:
   * there is only ever one working day per level, and a screen that could
   * produce two would leave the sheet with a choice to make.
   */
  async save(companyId: number, dto: SaveAttendanceSettingDto) {
    if (!companyId) {
      throw new BadRequestException('No active company.');
    }
    if (dto.defaultTimeIn === dto.defaultTimeOut) {
      throw new BadRequestException(
        'The day cannot start and finish at the same minute.',
      );
    }
    const branchId = dto.branchId ?? null;
    if (branchId) await this.ensureBranch(companyId, branchId);
    if (dto.defaultTypeId) await this.ensureType(dto.defaultTypeId);

    // Postgres counts NULLs as distinct, so the unique index does not stop a
    // second company-level row — found by hand and updated in place.
    const existing = await this.prisma.attendanceSetting.findFirst({
      where: { companyId, branchId },
      select: { id: true },
    });
    const data = {
      defaultTimeIn: dto.defaultTimeIn,
      defaultTimeOut: dto.defaultTimeOut,
      defaultTypeId: dto.defaultTypeId ?? null,
      weeklyOffDays: [...new Set(dto.weeklyOffDays ?? [])].sort(),
    };
    return existing
      ? this.prisma.attendanceSetting.update({
          where: { id: existing.id },
          data,
        })
      : this.prisma.attendanceSetting.create({
          data: { companyId, branchId, ...data },
        });
  }

  /** Drop a branch's own row, so it falls back to the company's again. */
  async remove(companyId: number, id: number) {
    const row = await this.prisma.attendanceSetting.findFirst({
      where: { id, companyId },
    });
    if (!row) throw new BadRequestException('No such attendance setting.');
    if (row.branchId === null) {
      throw new BadRequestException(
        'The company default cannot be removed — every branch without its own rule falls back to it.',
      );
    }
    await this.prisma.attendanceSetting.delete({ where: { id } });
    return { success: true };
  }

  // ------------------------------------------------------------ holidays --

  /** One year's holidays, in date order. */
  async holidays(companyId: number | undefined, year?: number) {
    if (!companyId) return [];
    const y = year && year > 1900 ? year : new Date().getUTCFullYear();
    return this.prisma.attendanceHoliday.findMany({
      where: {
        companyId,
        date: {
          gte: new Date(Date.UTC(y, 0, 1)),
          lt: new Date(Date.UTC(y + 1, 0, 1)),
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async saveHoliday(companyId: number, id: number | null, dto: SaveHolidayDto) {
    if (!companyId) throw new BadRequestException('No active company.');
    const branchId = dto.branchId ?? null;
    if (branchId) await this.ensureBranch(companyId, branchId);
    const date = new Date(`${dto.date.slice(0, 10)}T00:00:00.000Z`);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('That is not a date.');
    }
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the holiday a name.');

    const clash = await this.prisma.attendanceHoliday.findFirst({
      where: { companyId, branchId, date, ...(id ? { id: { not: id } } : {}) },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new BadRequestException(
        `That day is already down as "${clash.name}".`,
      );
    }
    return id
      ? this.prisma.attendanceHoliday.update({
          where: { id },
          data: { branchId, date, name },
        })
      : this.prisma.attendanceHoliday.create({
          data: { companyId, branchId, date, name },
        });
  }

  async removeHoliday(companyId: number, id: number) {
    const row = await this.prisma.attendanceHoliday.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('No such holiday.');
    await this.prisma.attendanceHoliday.delete({ where: { id } });
    return { success: true };
  }

  /**
   * The holiday falling on one day for one branch, if any.
   *
   * A branch's own local holiday first, then the company-wide one — the same
   * order of precedence the working day itself follows.
   */
  async holidayOn(companyId: number, branchId: number | null, date: Date) {
    const rows = await this.prisma.attendanceHoliday.findMany({
      where: {
        companyId,
        date,
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
    });
    return rows.find((r) => r.branchId === branchId) ?? rows[0] ?? null;
  }

  // ------------------------------------------------------------- guards --

  private async ensureBranch(companyId: number, branchId: number) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException('That branch is not in this company.');
    }
  }

  private async ensureType(typeId: number) {
    const value = await this.prisma.lookupValue.findFirst({
      where: { id: typeId, lookup: { code: ATTENDANCE_TYPE_LOOKUP } },
      select: { id: true },
    });
    if (!value) {
      throw new BadRequestException('That is not an attendance type.');
    }
  }
}
