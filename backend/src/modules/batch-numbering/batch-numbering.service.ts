import { BadRequestException, Injectable } from '@nestjs/common';
import { BatchDateFormat, BatchRenumber } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchNumberingPort } from '../../contracts/batch-numbering.port';
import { SaveBatchNumberingRuleDto } from './batch-numbering.dto';

/** Rule fields the format()/period helpers read. */
interface RuleState {
  prefixEnabled: boolean;
  prefixValue: string | null;
  dateFormat: BatchDateFormat;
  paddingLength: number;
  startingNo: number;
  renumber: BatchRenumber;
}

@Injectable()
export class BatchNumberingService implements BatchNumberingPort {
  constructor(private prisma: PrismaService) {}

  /** A row per branch of the active company with its rule or defaults, plus a
   *  live NEXT example. Branch-less batches use the built-in fallback scheme;
   *  there is no company-level rule. */
  async overview(companyId: number | undefined) {
    const branches = companyId
      ? await this.prisma.branch.findMany({
          where: { companyId },
          orderBy: { name: 'asc' },
        })
      : [];
    const rules = companyId
      ? await this.prisma.batchNumberingRule.findMany({ where: { companyId } })
      : [];
    const byBranch = new Map(rules.map((r) => [r.branchId ?? 0, r]));

    const targets: { branchId: number | null; branchName: string }[] =
      branches.map((b) => ({ branchId: b.id, branchName: b.name }));
    return targets.map((t) => {
      const r = byBranch.get(t.branchId ?? 0);
      const state: RuleState = {
        prefixEnabled: r?.prefixEnabled ?? true,
        prefixValue: r?.prefixValue ?? null,
        dateFormat: (r?.dateFormat ?? 'YYMMDD') as BatchDateFormat,
        paddingLength: r?.paddingLength ?? 4,
        startingNo: r?.startingNo ?? 1,
        renumber: (r?.renumber ?? 'DAILY') as BatchRenumber,
      };
      return {
        branchId: t.branchId,
        branchName: t.branchName,
        configured: !!r,
        ...state,
        isLocked: r?.isLocked ?? false,
        preview: this.format(state, state.startingNo, new Date()),
      };
    });
  }

  async save(companyId: number | undefined, dto: SaveBatchNumberingRuleDto) {
    if (!companyId) {
      throw new BadRequestException(
        'Select a company before setting batch numbering.',
      );
    }
    if (dto.branchId == null) {
      throw new BadRequestException(
        'Select a branch. Branch-less batches use the built-in numbering scheme.',
      );
    }
    const branchId = dto.branchId;
    const existing = await this.prisma.batchNumberingRule.findFirst({
      where: { companyId, branchId },
    });
    if (existing?.isLocked) {
      throw new BadRequestException(
        'This rule is locked. Unlock it first to edit.',
      );
    }
    const prefixEnabled = dto.prefixEnabled ?? true;
    const data = {
      prefixEnabled,
      prefixValue: prefixEnabled ? dto.prefixValue?.trim() || null : null,
      dateFormat: (dto.dateFormat ?? 'YYMMDD') as BatchDateFormat,
      paddingLength: dto.paddingLength ?? 4,
      startingNo: dto.startingNo ?? 1,
      renumber: (dto.renumber ?? 'DAILY') as BatchRenumber,
    };
    if (existing) {
      return this.prisma.batchNumberingRule.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.batchNumberingRule.create({
      data: { companyId, branchId, ...data },
    });
  }

  async remove(companyId: number | undefined, branchId: number | null) {
    if (companyId) {
      const existing = await this.prisma.batchNumberingRule.findFirst({
        where: { companyId, branchId: branchId ?? null },
      });
      if (existing?.isLocked) {
        throw new BadRequestException(
          'This rule is locked. Unlock it first to remove.',
        );
      }
      if (existing) {
        await this.prisma.batchNumberingRule.delete({
          where: { id: existing.id },
        });
      }
    }
    return { success: true };
  }

  async setLock(
    companyId: number | undefined,
    branchId: number | null,
    locked: boolean,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before locking.');
    }
    if (branchId == null) {
      throw new BadRequestException(
        'Select a branch to lock its numbering rule.',
      );
    }
    const b = branchId;
    const existing = await this.prisma.batchNumberingRule.findFirst({
      where: { companyId, branchId: b },
    });
    if (existing) {
      await this.prisma.batchNumberingRule.update({
        where: { id: existing.id },
        data: { isLocked: locked },
      });
    } else {
      await this.prisma.batchNumberingRule.create({
        data: { companyId, branchId: b, isLocked: locked },
      });
    }
    return { success: true };
  }

  // ---- BatchNumberingPort ----

  async nextRange(
    companyId: number,
    branchId: number | null,
    count: number,
    date: Date = new Date(),
  ): Promise<string[] | null> {
    const rule = await this.prisma.batchNumberingRule.findFirst({
      where: { companyId, branchId: branchId ?? null },
    });
    if (!rule) return null;
    // Derive the next number from the highest existing sequence for this rule's
    // period (not a stored counter), so back-dated / out-of-order entry stays
    // correct — max(day/month/year) + 1, or the starting number when none.
    const base = await this.maxSeqForPeriod(rule, companyId, date);
    const nos: string[] = [];
    for (let i = 1; i <= count; i++)
      nos.push(this.format(rule, base + i, date));
    return nos;
  }

  /** Highest batch sequence already used in this rule's current period (returns
   *  startingNo - 1 when none, so the first generated number is startingNo). */
  private async maxSeqForPeriod(
    rule: RuleState,
    companyId: number,
    date: Date,
  ): Promise<number> {
    const like = this.periodPrefix(rule, date);
    const batches = await this.prisma.stockBatch.findMany({
      where: { companyId, batchNo1: { startsWith: like } },
      select: { batchNo1: true },
    });
    let max = (rule.startingNo || 1) - 1;
    for (const b of batches) {
      // The sequence is the number after the final '-'.
      const seq = Number(b.batchNo1?.split('-').pop());
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
    return max;
  }

  // ---- formatting ----

  private format(rule: RuleState, num: number, date: Date): string {
    const body = String(num).padStart(rule.paddingLength || 4, '0');
    const prefix = rule.prefixEnabled ? (rule.prefixValue ?? '') : '';
    return `${prefix}${this.dateStr(rule.dateFormat, date)}-${body}`;
  }

  private dateStr(fmt: BatchDateFormat, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return fmt === 'YYYYMMDD'
      ? `${y}${m}${d}`
      : `${String(y).slice(2)}${m}${d}`;
  }

  /** The batchNo1 prefix that scopes a period: prefix + the period-relevant part
   *  of the date (full date for DAILY, YYMM/YYYYMM for MONTHLY, YY/YYYY for
   *  YEARLY). Batches with this prefix belong to the same counter period. */
  private periodPrefix(rule: RuleState, date: Date): string {
    const prefix = rule.prefixEnabled ? (rule.prefixValue ?? '') : '';
    const dateStr = this.dateStr(rule.dateFormat, date);
    const yyyy = rule.dateFormat === 'YYYYMMDD';
    let datePart = dateStr; // DAILY: full date
    if (rule.renumber === 'MONTHLY') datePart = dateStr.slice(0, yyyy ? 6 : 4);
    else if (rule.renumber === 'YEARLY')
      datePart = dateStr.slice(0, yyyy ? 4 : 2);
    return `${prefix}${datePart}`;
  }
}
