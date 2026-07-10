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

  /** A row per branch of the active company (+ a company-level row) with its
   *  rule or defaults, plus a live NEXT example. */
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

    const targets: { branchId: number | null; branchName: string }[] = [
      { branchId: null, branchName: '— Company (no branch) —' },
      ...branches.map((b) => ({ branchId: b.id, branchName: b.name })),
    ];
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
      throw new BadRequestException('Select a company before setting batch numbering.');
    }
    const branchId = dto.branchId ?? null;
    const existing = await this.prisma.batchNumberingRule.findFirst({
      where: { companyId, branchId },
    });
    if (existing?.isLocked) {
      throw new BadRequestException('This rule is locked. Unlock it first to edit.');
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
      return this.prisma.batchNumberingRule.update({ where: { id: existing.id }, data });
    }
    return this.prisma.batchNumberingRule.create({ data: { companyId, branchId, ...data } });
  }

  async remove(companyId: number | undefined, branchId: number | null) {
    if (companyId) {
      const existing = await this.prisma.batchNumberingRule.findFirst({
        where: { companyId, branchId: branchId ?? null },
      });
      if (existing?.isLocked) {
        throw new BadRequestException('This rule is locked. Unlock it first to remove.');
      }
      if (existing) {
        await this.prisma.batchNumberingRule.delete({ where: { id: existing.id } });
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
    const b = branchId ?? null;
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

  async next(
    companyId: number,
    branchId: number | null,
    date: Date = new Date(),
  ): Promise<string | null> {
    const rule = await this.prisma.batchNumberingRule.findFirst({
      where: { companyId, branchId: branchId ?? null },
    });
    if (!rule) return null;
    const periodKey = this.periodKey(rule.renumber, date);
    const num = await this.prisma.$transaction(async (tx) => {
      const r = await tx.batchNumberingRule.findUnique({ where: { id: rule.id } });
      if (!r) return null;
      const n = r.lastPeriodKey === periodKey ? r.lastNumber + 1 : r.startingNo;
      await tx.batchNumberingRule.update({
        where: { id: rule.id },
        data: { lastPeriodKey: periodKey, lastNumber: n },
      });
      return n;
    });
    if (num == null) return null;
    return this.format(rule, num, date);
  }

  // ---- formatting ----

  private format(rule: RuleState, num: number, date: Date): string {
    const body = String(num).padStart(rule.paddingLength || 4, '0');
    const prefix = rule.prefixEnabled ? rule.prefixValue ?? '' : '';
    return `${prefix}${this.dateStr(rule.dateFormat, date)}-${body}`;
  }

  private dateStr(fmt: BatchDateFormat, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return fmt === 'YYYYMMDD' ? `${y}${m}${d}` : `${String(y).slice(2)}${m}${d}`;
  }

  /** Counter reset bucket: day, month, or year. */
  private periodKey(renumber: BatchRenumber, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (renumber === 'DAILY') return `${y}${m}${d}`;
    if (renumber === 'MONTHLY') return `${y}${m}`;
    return `${y}`;
  }
}
