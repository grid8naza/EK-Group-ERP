import { BadRequestException, Injectable } from '@nestjs/common';
import { NumberingPeriodPosition, NumberingRenumber } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingPort } from '../../contracts/numbering.port';
import { SaveNumberingRuleDto } from './document-numbering.dto';

/** Rule + running counter as stored (the shape format()/periodKey() read). */
interface RuleState {
  prefixEnabled: boolean;
  prefixValue: string | null;
  startingNo: number;
  suffixEnabled: boolean;
  suffixValue: string | null;
  paddingLength: number;
  renumber: NumberingRenumber;
  periodPosition: NumberingPeriodPosition;
}

@Injectable()
export class DocumentNumberingService implements NumberingPort {
  constructor(private prisma: PrismaService) {}

  /** Every active document plus this company's rule (or defaults if unset). */
  async overview(companyId: number | undefined) {
    const docs = await this.prisma.document.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const rules = companyId
      ? await this.prisma.documentNumberingRule.findMany({ where: { companyId } })
      : [];
    const byDoc = new Map(rules.map((r) => [r.documentId, r]));
    return docs.map((d) => {
      const r = byDoc.get(d.id);
      return {
        documentId: d.id,
        documentName: d.name,
        documentCode: d.code,
        isSystem: d.isSystem,
        configured: !!r,
        prefixEnabled: r?.prefixEnabled ?? true,
        prefixValue: r?.prefixValue ?? null,
        startingNo: r?.startingNo ?? 1,
        suffixEnabled: r?.suffixEnabled ?? false,
        suffixValue: r?.suffixValue ?? null,
        paddingLength: r?.paddingLength ?? 5,
        renumber: r?.renumber ?? 'NEVER',
        periodPosition: r?.periodPosition ?? 'BEFORE_SUFFIX',
        isLocked: r?.isLocked ?? false,
        lastNumber: r?.lastNumber ?? 0,
        // Live example so the config is easy to eyeball.
        preview: this.format(
          {
            prefixEnabled: r?.prefixEnabled ?? true,
            prefixValue: r?.prefixValue ?? null,
            startingNo: r?.startingNo ?? 1,
            suffixEnabled: r?.suffixEnabled ?? false,
            suffixValue: r?.suffixValue ?? null,
            paddingLength: r?.paddingLength ?? 5,
            renumber: (r?.renumber ?? 'NEVER') as NumberingRenumber,
            periodPosition: (r?.periodPosition ??
              'BEFORE_SUFFIX') as NumberingPeriodPosition,
          },
          r?.startingNo ?? 1,
          new Date(),
        ),
      };
    });
  }

  async save(companyId: number | undefined, dto: SaveNumberingRuleDto) {
    if (!companyId) {
      throw new BadRequestException('Select a company before setting numbering.');
    }
    const doc = await this.prisma.document.findUnique({
      where: { id: dto.documentId },
    });
    if (!doc) throw new BadRequestException('Choose a valid document.');

    const current = await this.prisma.documentNumberingRule.findUnique({
      where: { companyId_documentId: { companyId, documentId: dto.documentId } },
    });
    if (current?.isLocked) {
      throw new BadRequestException(
        'This numbering rule is locked. Unlock it first to edit.',
      );
    }

    const prefixEnabled = dto.prefixEnabled ?? true;
    const suffixEnabled = dto.suffixEnabled ?? false;
    const data = {
      prefixEnabled,
      prefixValue: prefixEnabled ? dto.prefixValue?.trim() || null : null,
      startingNo: dto.startingNo ?? 1,
      suffixEnabled,
      suffixValue: suffixEnabled ? dto.suffixValue?.trim() || null : null,
      paddingLength: dto.paddingLength ?? 5,
      renumber: (dto.renumber ?? 'NEVER') as NumberingRenumber,
      periodPosition: (dto.periodPosition ??
        'BEFORE_SUFFIX') as NumberingPeriodPosition,
    };
    return this.prisma.documentNumberingRule.upsert({
      where: { companyId_documentId: { companyId, documentId: dto.documentId } },
      create: { companyId, documentId: dto.documentId, ...data },
      update: data,
    });
  }

  async remove(companyId: number | undefined, documentId: number) {
    if (companyId) {
      const existing = await this.prisma.documentNumberingRule.findUnique({
        where: { companyId_documentId: { companyId, documentId } },
      });
      if (existing?.isLocked) {
        throw new BadRequestException(
          'This numbering rule is locked. Unlock it first to remove.',
        );
      }
      await this.prisma.documentNumberingRule.deleteMany({
        where: { companyId, documentId },
      });
    }
    return { success: true };
  }

  /** Lock/unlock the (company, document) rule, creating a default one if needed. */
  async setLock(
    companyId: number | undefined,
    documentId: number,
    locked: boolean,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before locking.');
    }
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new BadRequestException('Choose a valid document.');
    await this.prisma.documentNumberingRule.upsert({
      where: { companyId_documentId: { companyId, documentId } },
      create: { companyId, documentId, isLocked: locked },
      update: { isLocked: locked },
    });
    return { success: true };
  }

  // ---- NumberingPort ----

  async next(
    companyId: number,
    documentCode: string,
    date: Date = new Date(),
  ): Promise<string | null> {
    const doc = await this.prisma.document.findUnique({
      where: { code: documentCode },
      select: { id: true },
    });
    if (!doc) return null;
    const rule = await this.prisma.documentNumberingRule.findUnique({
      where: { companyId_documentId: { companyId, documentId: doc.id } },
    });
    if (!rule) return null;

    const periodKey = this.periodKey(rule.renumber, date);
    // Advance the counter, resetting when the renumber period rolls over.
    const num = await this.prisma.$transaction(async (tx) => {
      const r = await tx.documentNumberingRule.findUnique({ where: { id: rule.id } });
      if (!r) return null;
      const n = r.lastPeriodKey === periodKey ? r.lastNumber + 1 : r.startingNo;
      await tx.documentNumberingRule.update({
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
    const body = String(num).padStart(rule.paddingLength || 5, '0');
    const prefix = rule.prefixEnabled ? rule.prefixValue ?? '' : '';
    const suffix = rule.suffixEnabled ? rule.suffixValue ?? '' : '';
    const period = this.periodToken(rule.renumber, date);
    // The month/year token sits before or after the configured suffix.
    if (period && rule.periodPosition === 'AFTER_SUFFIX') {
      return `${prefix}${body}${suffix}${period}`;
    }
    return `${prefix}${body}${period}${suffix}`;
  }

  /** Bucket the counter resets by: month, year, or a single all-time bucket. */
  private periodKey(renumber: NumberingRenumber, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    if (renumber === 'MONTHLY') return `${y}${m}`;
    if (renumber === 'YEARLY') return `${y}`;
    return 'ALL';
  }

  /** The month/year token appended to the number (empty for NEVER). */
  private periodToken(renumber: NumberingRenumber, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    if (renumber === 'MONTHLY') return `-${m}-${y}`; // e.g. -07-2026
    if (renumber === 'YEARLY') return `${y}`; // e.g. 2026 (no leading hyphen)
    return '';
  }
}
