import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CcRequirement,
  COA_ACCOUNTS,
  COA_ADOPTIONS,
  COA_COMPANY_BY_CODE,
  COA_COST_CENTRE_CATEGORIES,
  COA_GROUPS,
} from './coa-data';

/**
 * The annexure states a cost-centre rule per account (Mandatory / Optional /
 * n/a); this ERP asks two plainer questions at data entry — does the line carry
 * a cost centre, and does it carry a cost object. The starting position is read
 * off the annexure rather than left to someone to set 253 times:
 *
 *   · anything the annexure allows a centre on asks for the DIVISION;
 *   · anything it makes mandatory also asks for the DEPARTMENT beneath it,
 *     since those are the operating accounts the department analysis is for;
 *   · n/a — tax, control and clearing accounts — asks for neither.
 *
 * It is only a default. Either box can be changed per account afterwards, and
 * the seed never writes over an account that already exists.
 */
export const ccDefaultsOf = (rule: CcRequirement) => ({
  hasCostCenter: rule !== 'NOT_APPLICABLE',
  hasCostObject: rule === 'MANDATORY',
});

/**
 * Loads the Annexure D Chart of Accounts on boot, so every database carries the
 * same account master without anyone running SQL by hand.
 *
 * Idempotent and ADDITIVE, in the same spirit as the module/menu scaffold: a
 * missing group, account, adoption or category is created, an existing one is
 * left alone. It deliberately does NOT overwrite an existing row — once the
 * finance team has renamed an account or deactivated one for a company, that is
 * their decision and a redeploy must not undo it. A revised annexure is applied
 * by re-converting the data file and reconciling deliberately, not by having
 * every boot force the shipped values back.
 *
 * Runs after the company records exist; adoption rows are matched to companies
 * by code (see COA_COMPANY_BY_CODE), and a company that is not present yet is
 * skipped rather than failing the boot.
 */
@Injectable()
export class CoaSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CoaSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const groups = await this.seedGroups();
      const accounts = await this.seedAccounts();
      const adoptions = await this.seedAdoptions();
      const categories = await this.seedCategories();
      await this.markShipped();
      await this.backfillCostFlags();
      if (groups || accounts || adoptions || categories) {
        this.logger.log(
          `Chart of Accounts seeded: +${groups} groups, +${accounts} accounts, ` +
            `+${adoptions} company adoptions, +${categories} cost-centre categories.`,
        );
      }
    } catch (e) {
      // The books are not readable without the master, but a failure here must
      // not stop the app booting — it is logged and retried next start.
      this.logger.error(
        `Chart of Accounts seed failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Flag everything the annexure ships as system, so it can be renamed or
   * deactivated but never deleted.
   *
   * Unlike the seeding above this DOES write to existing rows, deliberately:
   * being shipped by the annexure is a fact about where a row came from, not a
   * preference someone might have changed. It also back-fills databases seeded
   * before the flag existed.
   */
  private async markShipped(): Promise<void> {
    await this.prisma.accountGroup.updateMany({
      where: { code: { in: COA_GROUPS.map((g) => g.code) }, isSystem: false },
      data: { isSystem: true },
    });
    await this.prisma.account.updateMany({
      where: { code: { in: COA_ACCOUNTS.map((a) => a.code) }, isSystem: false },
      data: { isSystem: true },
    });
  }

  /**
   * Give the cost-centre / cost-object boxes their starting position in a
   * database seeded before they existed — otherwise every one of the 253
   * accounts would read "asks for neither" and the whole master would have to
   * be ticked by hand.
   *
   * Runs at most once in practice: it is skipped the moment ANY account has
   * either box ticked, which is true straight after this has run and true of a
   * freshly seeded database (seedAccounts sets them on the way in). That guard
   * is what stops a redeploy from re-ticking a box someone deliberately
   * cleared.
   */
  private async backfillCostFlags(): Promise<void> {
    const alreadySet = await this.prisma.account.count({
      where: { OR: [{ hasCostCenter: true }, { hasCostObject: true }] },
    });
    if (alreadySet) return;

    let updated = 0;
    // Two writes rather than 253: the defaults take only two distinct shapes.
    for (const rule of ['MANDATORY', 'OPTIONAL'] as const) {
      const codes = COA_ACCOUNTS.filter((a) => a.ccRequirement === rule).map(
        (a) => a.code,
      );
      if (!codes.length) continue;
      const res = await this.prisma.account.updateMany({
        where: { code: { in: codes } },
        data: ccDefaultsOf(rule),
      });
      updated += res.count;
    }
    if (updated) {
      this.logger.log(
        `Cost-centre defaults applied to ${updated} existing accounts.`,
      );
    }
  }

  /**
   * Groups reference their parent by code, so they are inserted parents-first:
   * sorting by code is enough, since a parent's code is always numerically lower
   * than its children's (10000 before 10100).
   */
  private async seedGroups(): Promise<number> {
    const existing = new Map(
      (
        await this.prisma.accountGroup.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    let created = 0;
    for (const g of [...COA_GROUPS].sort((a, b) => a.code.localeCompare(b.code))) {
      if (existing.has(g.code)) continue;
      const parentId = g.parentCode ? (existing.get(g.parentCode) ?? null) : null;
      if (g.parentCode && parentId == null) {
        // Cannot happen with the shipped data (the converter checks it), but a
        // silent orphan would be worse than a loud skip.
        this.logger.warn(`Group ${g.code} skipped: parent ${g.parentCode} missing.`);
        continue;
      }
      const row = await this.prisma.accountGroup.create({
        data: {
          code: g.code,
          name: g.name,
          parentGroupId: parentId,
          nature: g.nature,
          normalSide: g.normalSide,
          statement: g.statement,
          tallyGroup: g.tallyGroup,
          sortOrder: g.sortOrder,
        },
        select: { id: true },
      });
      existing.set(g.code, row.id);
      created++;
    }
    return created;
  }

  private async seedAccounts(): Promise<number> {
    const groupIds = new Map(
      (
        await this.prisma.accountGroup.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    const existing = new Set(
      (await this.prisma.account.findMany({ select: { code: true } })).map(
        (a) => a.code,
      ),
    );
    let created = 0;
    for (const a of COA_ACCOUNTS) {
      if (existing.has(a.code)) continue;
      const groupId = groupIds.get(a.groupCode);
      if (groupId == null) {
        this.logger.warn(`Account ${a.code} skipped: group ${a.groupCode} missing.`);
        continue;
      }
      await this.prisma.account.create({
        data: {
          code: a.code,
          name: a.name,
          groupId,
          nature: a.nature,
          normalSide: a.normalSide,
          statement: a.statement,
          tallyGroup: a.tallyGroup,
          isContra: a.isContra,
          isControl: a.isControl,
          controlParty: a.controlParty,
          ...ccDefaultsOf(a.ccRequirement),
          isGstRelevant: a.isGstRelevant,
          isBankOrCash: a.isBankOrCash,
          isReconcilable: a.isReconcilable,
          isIntercompany: a.isIntercompany,
          eliminationPair: a.eliminationPair,
          allowManualJe: a.allowManualJe,
          // Everything the annexure ships is a system account: it is the signed
          // -off master, so it may be deactivated but never deleted.
          isSystem: true,
          notes: a.notes,
          sortOrder: a.sortOrder,
        },
      });
      created++;
    }
    return created;
  }

  /**
   * Adoption is what makes the shared master usable per company: the trading
   * company never sees a production account because it never adopted one.
   */
  private async seedAdoptions(): Promise<number> {
    const companies = new Map(
      (
        await this.prisma.company.findMany({ select: { id: true, code: true } })
      ).map((c) => [c.code, c.id]),
    );
    const accountIds = new Map(
      (await this.prisma.account.findMany({ select: { id: true, code: true } })).map(
        (a) => [a.code, a.id],
      ),
    );
    const existing = new Set(
      (
        await this.prisma.accountCompany.findMany({
          select: { companyId: true, accountId: true },
        })
      ).map((r) => `${r.companyId}:${r.accountId}`),
    );

    const rows: { companyId: number; accountId: number }[] = [];
    const missingCompanies = new Set<string>();
    for (const [accountCode, coaCompanies] of Object.entries(COA_ADOPTIONS)) {
      const accountId = accountIds.get(accountCode);
      if (accountId == null) continue;
      for (const coaCode of coaCompanies) {
        const companyCode = COA_COMPANY_BY_CODE[coaCode];
        const companyId = companyCode ? companies.get(companyCode) : undefined;
        if (companyId == null) {
          missingCompanies.add(`${coaCode} (${companyCode ?? '?'})`);
          continue;
        }
        if (existing.has(`${companyId}:${accountId}`)) continue;
        rows.push({ companyId, accountId });
      }
    }
    if (missingCompanies.size) {
      this.logger.warn(
        `Adoptions skipped for companies not in this database: ${[
          ...missingCompanies,
        ].join(', ')}`,
      );
    }
    if (!rows.length) return 0;
    const res = await this.prisma.accountCompany.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return res.count;
  }

  private async seedCategories(): Promise<number> {
    const existing = new Set(
      (
        await this.prisma.costCentreCategory.findMany({ select: { code: true } })
      ).map((c) => c.code),
    );
    const rows = COA_COST_CENTRE_CATEGORIES.filter(
      (c) => !existing.has(c.code),
    ).map((c, i) => ({
      code: c.code,
      name: c.name,
      description: c.description,
      isMandatory: c.isMandatory,
      sortOrder: i,
    }));
    if (!rows.length) return 0;
    const res = await this.prisma.costCentreCategory.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return res.count;
  }
}
