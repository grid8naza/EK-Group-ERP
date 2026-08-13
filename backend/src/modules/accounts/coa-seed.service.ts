import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ISSUER_BANKS,
  ISSUER_BANK_LOOKUP,
  PAYMENT_MODES,
  PAYMENT_MODE_LOOKUP,
} from '../../common/instruments';
import { BANK_ACCOUNT_TYPES, BANK_ACCOUNT_TYPE_LOOKUP } from './bank-details';
import { COA_MAIN_GROUPS, COA_MAIN_GROUP_CORRECTIONS } from './main-groups';
import {
  COA_ACCOUNT_RENAMES,
  COA_CLOSED_BLOCKS,
  COA_SHIPPED_CC_RULES,
  COA_GROUP_RENAMES,
  COA_RECODED_ACCOUNTS,
  COA_RECODED_GROUPS,
  COA_RETIRED_ACCOUNTS,
} from './coa-revisions';
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
 * Is this code EMPTY because a revision is about to move an existing row into
 * it? Then it is not a missing row, and seeding one here would duplicate the
 * row that is on its way — the same account under two codes, each holding half
 * of what should be one balance.
 *
 * The recode runs before the seed, so in a complete deployment this never
 * fires. It fires when the two halves of a revision arrive apart — a data file
 * edited before its revision entry is written, which is exactly how a chart
 * change gets made — and it is the difference between a boot that waits and a
 * boot that quietly doubles the block.
 *
 * `existing` must be the codes the database held BEFORE this seed run, not a
 * set the run is still adding to. A row the seed has just created cannot be one
 * a revision is waiting to move, and treating it as one skips a code that is
 * genuinely missing.
 */
const awaitingRecode = (
  recodes: readonly { from: string; to: string }[],
  code: string,
  existing: { has(code: string): boolean },
) => recodes.some((r) => r.to === code && existing.has(r.from));

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
      // FIRST, before anything is created: the revisions move the chart that is
      // already here on to the revised master — renaming, withdrawing and
      // renumbering. Seeding afterwards then adds only what is genuinely
      // missing. The other way round, seeding would create a second account at
      // a code a revision was about to move an existing one into.
      await this.applyRevisions();
      const groups = await this.seedGroups();
      const accounts = await this.seedAccounts();
      const adoptions = await this.seedAdoptions();
      const categories = await this.seedCategories();
      await this.seedPaymentModes();
      await this.seedIssuerBanks();
      await this.seedBankAccountTypes();
      await this.backfillPdcLedgers();
      await this.markShipped();
      await this.backfillCostFlags();
      await this.backfillMainGroups();
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
   * How money moves through a bank — the list a bank voucher picks from.
   *
   * A lookup rather than an enum, because this is the company's list: a bank
   * that stops taking one of these, or starts taking something new, is a change
   * to reference data and not to the software. Cheque is the one the code knows
   * by name, since a cheque is the only one of them with a life after the
   * payment; see PdcStatus.
   *
   * Owned by the Accounts module, so it is edited from that module's Lookups
   * screen and appears in no other.
   */
  private async seedPaymentModes(): Promise<void> {
    const module = await this.prisma.module.findUnique({
      where: { code: 'ACCOUNTS' },
      select: { id: true },
    });
    const lookup = await this.prisma.lookup.upsert({
      where: { code: PAYMENT_MODE_LOOKUP },
      create: {
        code: PAYMENT_MODE_LOOKUP,
        name: 'Payment Mode',
        moduleId: module?.id ?? null,
        isSystem: true,
        description: 'How a bank receipt or payment moved the money.',
      },
      update: { isSystem: true },
    });
    for (const [i, value] of PAYMENT_MODES.entries()) {
      await this.prisma.lookupValue.upsert({
        where: { lookupId_value: { lookupId: lookup.id, value } },
        create: { lookupId: lookup.id, value, label: value, sortOrder: i },
        // Only the order: a company may rename "Card" to "POS card" and that
        // is theirs to keep.
        update: { sortOrder: i },
      });
    }
  }

  /**
   * The banks other people's cheques are drawn on — see ISSUER_BANK_LOOKUP.
   *
   * Seeded once and then left alone: the list is the company's, and a bank
   * renamed or retired there stays that way through every redeploy.
   */
  private async seedIssuerBanks(): Promise<void> {
    const module = await this.prisma.module.findUnique({
      where: { code: 'ACCOUNTS' },
      select: { id: true },
    });
    const lookup = await this.prisma.lookup.upsert({
      where: { code: ISSUER_BANK_LOOKUP },
      create: {
        code: ISSUER_BANK_LOOKUP,
        name: 'Issuer Bank',
        moduleId: module?.id ?? null,
        isSystem: true,
        description: 'The banks cheques taken in are drawn on.',
      },
      update: { isSystem: true },
    });
    // Only when the list is empty. Once anyone has touched it, it is theirs.
    const has = await this.prisma.lookupValue.count({
      where: { lookupId: lookup.id },
    });
    if (has) return;
    await this.prisma.lookupValue.createMany({
      data: ISSUER_BANKS.map((value, i) => ({
        lookupId: lookup.id,
        value,
        label: value,
        sortOrder: i,
      })),
    });
  }

  /**
   * What kind of account each of OUR bank ledgers is — see BankAccountDetail.
   *
   * Seeded once and then the company's, like the issuer banks: a group that
   * opens a facility nobody thought of adds the kind on the Lookups screen.
   */
  private async seedBankAccountTypes(): Promise<void> {
    const module = await this.prisma.module.findUnique({
      where: { code: 'ACCOUNTS' },
      select: { id: true },
    });
    const lookup = await this.prisma.lookup.upsert({
      where: { code: BANK_ACCOUNT_TYPE_LOOKUP },
      create: {
        code: BANK_ACCOUNT_TYPE_LOOKUP,
        name: 'Bank Account Type',
        moduleId: module?.id ?? null,
        isSystem: true,
        description: "What kind of account the company's own bank ledger is.",
      },
      update: { isSystem: true },
    });
    const has = await this.prisma.lookupValue.count({
      where: { lookupId: lookup.id },
    });
    if (has) return;
    await this.prisma.lookupValue.createMany({
      data: BANK_ACCOUNT_TYPES.map((value, i) => ({
        lookupId: lookup.id,
        value,
        label: value,
        sortOrder: i,
      })),
    });
  }

  /**
   * Tick the two post-dated cheque ledgers in a database that already had them
   * before the flags existed — otherwise a bank payment by PDC would find no
   * ledger to offer and the register could never be used.
   *
   * Only where NOTHING carries the flag yet: a company that has moved it to an
   * account of its own has decided where its cheques wait, and that decision
   * is not the seed's to overrule.
   */
  private async backfillPdcLedgers(): Promise<void> {
    for (const [code, flag] of [
      ['29010', 'isPdcIssued'],
      ['29011', 'isPdcReceived'],
    ] as const) {
      const already = await this.prisma.account.count({
        where: { [flag]: true },
      });
      if (already) continue;
      await this.prisma.account.updateMany({
        where: { code },
        data: { [flag]: true },
      });
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
   * Classify the blocks of a database seeded before the schedules existed —
   * otherwise the chart would have a tier with nothing in it and all 36 blocks
   * would have to be classified by hand.
   *
   * Only fills a group that has NONE, so a reclassification (moving Borrowings
   * to current, say) is never undone by a redeploy.
   */
  private async backfillMainGroups(): Promise<void> {
    let updated = 0;
    for (const [code, mainGroup] of Object.entries(COA_MAIN_GROUPS)) {
      const res = await this.prisma.accountGroup.updateMany({
        where: { code, mainGroup: null, parentGroupId: null },
        data: { mainGroup },
      });
      updated += res.count;
    }

    // Where the SHIPPED classification itself has changed, move the group on —
    // but only from the value it was shipped with, so a considered
    // reclassification is left alone.
    let corrected = 0;
    for (const c of COA_MAIN_GROUP_CORRECTIONS) {
      const res = await this.prisma.accountGroup.updateMany({
        where: { code: c.code, mainGroup: c.from, parentGroupId: null },
        data: { mainGroup: c.to },
      });
      corrected += res.count;
    }

    if (updated || corrected) {
      this.logger.log(
        `Main group set on ${updated} account groups, ${corrected} reclassified.`,
      );
    }
  }

  /**
   * Carry a database that already holds the chart to the revised master — the
   * renames and withdrawals in coa-revisions.ts.
   *
   * Everything here is keyed on the value the row was SHIPPED with, so it moves
   * the shipped chart on and leaves anything the finance team has since edited
   * exactly as they left it. Once applied, the guard stops matching and every
   * later boot is a no-op.
   */
  private async applyRevisions(): Promise<void> {
    let renamed = 0;
    for (const r of COA_GROUP_RENAMES) {
      const res = await this.prisma.accountGroup.updateMany({
        where: { code: r.code, name: r.from },
        data: { name: r.to },
      });
      renamed += res.count;
    }
    for (const r of COA_ACCOUNT_RENAMES) {
      const res = await this.prisma.account.updateMany({
        where: { code: r.code, name: r.from },
        data: { name: r.to },
      });
      renamed += res.count;
    }

    let removed = 0;
    let deactivated = 0;
    for (const r of COA_RETIRED_ACCOUNTS) {
      const account = await this.prisma.account.findUnique({
        where: { code: r.code },
        select: { id: true, name: true, isActive: true },
      });
      // Gone already, or repurposed here under another name — either way, not
      // ours to withdraw.
      if (!account || account.name !== r.was) continue;

      // An account with entries behind it is part of the books. Deleting it
      // would take the ledger with it, so it is closed to new postings instead
      // and the history stays readable.
      const posted = await this.prisma.voucherLine.count({
        where: { accountId: account.id },
      });
      if (posted) {
        if (account.isActive) {
          await this.prisma.account.update({
            where: { id: account.id },
            data: { isActive: false },
          });
          deactivated++;
          this.logger.warn(
            `Account ${r.code} (${r.was}) withdrawn from the master but has ` +
              `${posted} ledger lines — deactivated rather than deleted; ` +
              `re-point those entries and delete it by hand.`,
          );
        }
        continue;
      }
      // Untouched: it and its company adoptions go (AccountCompany cascades).
      await this.prisma.account.delete({ where: { id: account.id } });
      removed++;
    }

    // AFTER the withdrawals above, which is what frees the codes being moved
    // into. Same row throughout — adoptions, ledger and bills travel with it.
    let recoded = 0;
    for (const r of COA_RECODED_ACCOUNTS) {
      const account = await this.prisma.account.findUnique({
        where: { code: r.from },
        select: { id: true, name: true },
      });
      if (!account || account.name !== r.name) continue;
      const occupied = await this.prisma.account.findUnique({
        where: { code: r.to },
        select: { code: true },
      });
      if (occupied) {
        this.logger.warn(
          `Account ${r.from} not moved to ${r.to}: that code is taken.`,
        );
        continue;
      }
      const posted = await this.prisma.voucherLine.count({
        where: { accountId: account.id },
      });
      if (posted) {
        this.logger.warn(
          `Account ${r.from} (${r.name}) not moved to ${r.to}: it carries ` +
            `${posted} ledger lines, and a posted code is renumbered by hand.`,
        );
        continue;
      }
      await this.prisma.account.update({
        where: { id: account.id },
        data: { code: r.to },
      });
      recoded++;
    }

    // A group's code is only its own label — an account names its group by id,
    // so every account under it comes along untouched.
    for (const r of COA_RECODED_GROUPS) {
      const group = await this.prisma.accountGroup.findUnique({
        where: { code: r.from },
        select: { id: true, name: true },
      });
      if (!group || group.name !== r.name) continue;
      const occupied = await this.prisma.accountGroup.findUnique({
        where: { code: r.to },
        select: { code: true },
      });
      if (occupied) {
        this.logger.warn(
          `Group ${r.from} not moved to ${r.to}: that code is taken.`,
        );
        continue;
      }
      await this.prisma.accountGroup.update({
        where: { id: group.id },
        data: { code: r.to },
      });
      recoded++;
    }

    // AFTER the recodes: this map is keyed by the code an account ENDS with, so
    // reading it before they have moved would look up numbers nothing holds yet.
    //
    // What a line to the account is asked for: from the rule it SHIPPED with to
    // the one the master now states. Guarded on BOTH flags together, so an
    // account someone has already adjusted by hand is left as they set it.
    // Batched by the move being made rather than one write per account — a
    // hundred and fifty accounts take four updates, because a rule change of
    // this kind is only ever a handful of distinct moves.
    const wanted = new Map(COA_ACCOUNTS.map((a) => [a.code, a.ccRequirement]));
    const moves = new Map<
      string,
      {
        from: ReturnType<typeof ccDefaultsOf>;
        to: ReturnType<typeof ccDefaultsOf>;
        codes: string[];
      }
    >();
    for (const [code, shipped] of Object.entries(COA_SHIPPED_CC_RULES)) {
      const now = wanted.get(code);
      if (!now || now === shipped) continue;
      const key = `${shipped}->${now}`;
      const move = moves.get(key);
      if (move) move.codes.push(code);
      else
        moves.set(key, {
          from: ccDefaultsOf(shipped),
          to: ccDefaultsOf(now),
          codes: [code],
        });
    }
    let reruled = 0;
    for (const move of moves.values()) {
      const res = await this.prisma.account.updateMany({
        where: { code: { in: move.codes }, ...move.from },
        data: move.to,
      });
      reruled += res.count;
    }

    // Blocks the method does not post to. Guarded on the account still being
    // ACTIVE, so it applies once and then stops matching — and so a deliberate
    // re-opening on the Ledgers screen survives, up to the next boot. If the
    // method itself changes, the entry comes out of coa-revisions.ts; that is
    // where the decision lives, not in a checkbox.
    let closed = 0;
    for (const block of COA_CLOSED_BLOCKS) {
      const accounts = await this.prisma.account.findMany({
        where: { code: { in: block.accounts }, isActive: true },
        select: { id: true },
      });
      if (accounts.length) {
        const ids = accounts.map((a) => a.id);
        await this.prisma.account.updateMany({
          where: { id: { in: ids } },
          data: { isActive: false },
        });
        // Adoption is what puts an account in a picker; without this the block
        // would still be offered on every entry screen, merely inactive.
        const dropped = await this.prisma.accountCompany.deleteMany({
          where: { accountId: { in: ids } },
        });
        closed += accounts.length;
        this.logger.log(
          `Block ${block.group} closed for use: ${accounts.length} accounts ` +
            `deactivated, ${dropped.count} company adoptions withdrawn.`,
        );
      }
      await this.prisma.accountGroup.updateMany({
        where: { code: block.group, isActive: true },
        data: { isActive: false },
      });
    }

    const resorted = await this.restampFromMaster();

    if (
      renamed ||
      removed ||
      deactivated ||
      recoded ||
      reruled ||
      resorted ||
      closed
    ) {
      this.logger.log(
        `Chart of Accounts revised: ${renamed} renamed, ${removed} withdrawn, ` +
          `${deactivated} deactivated, ${recoded} recoded, ${reruled} re-ruled, ` +
          `${resorted} resorted, ${closed} closed for use.`,
      );
    }
  }

  /**
   * The two things the master states that no screen can set: the order the
   * chart READS in, and which account each intercompany account is eliminated
   * against.
   *
   * Unlike everything else here these are not guarded on a shipped value,
   * because neither is an opinion anyone holds — they are facts about the
   * annexure that only the data file can answer. Both also break silently on a
   * renumbering: a withdrawn account leaves a hole in the sequence, and a moved
   * account leaves its mirror pointing at whatever now holds the old code,
   * which is how 17001 came to name a provision as its own reflection.
   *
   * Sort order is one sequence over groups AND accounts, since a block heading
   * and the ledgers beneath it interleave.
   */
  private async restampFromMaster(): Promise<number> {
    let changed = 0;

    const groupWant = new Map(COA_GROUPS.map((g) => [g.code, g.sortOrder]));
    for (const g of await this.prisma.accountGroup.findMany({
      select: { id: true, code: true, sortOrder: true },
    })) {
      const want = groupWant.get(g.code);
      // Anything added here rather than shipped keeps the position it was given.
      if (want == null || want === g.sortOrder) continue;
      await this.prisma.accountGroup.update({
        where: { id: g.id },
        data: { sortOrder: want },
      });
      changed++;
    }

    const accountWant = new Map(
      COA_ACCOUNTS.map((a) => [
        a.code,
        { sortOrder: a.sortOrder, eliminationPair: a.eliminationPair },
      ]),
    );
    for (const a of await this.prisma.account.findMany({
      select: { id: true, code: true, sortOrder: true, eliminationPair: true },
    })) {
      const want = accountWant.get(a.code);
      if (!want) continue;
      const data: { sortOrder?: number; eliminationPair?: string | null } = {};
      if (want.sortOrder !== a.sortOrder) data.sortOrder = want.sortOrder;
      if ((want.eliminationPair ?? null) !== a.eliminationPair) {
        data.eliminationPair = want.eliminationPair ?? null;
      }
      if (!Object.keys(data).length) continue;
      await this.prisma.account.update({ where: { id: a.id }, data });
      changed++;
    }

    return changed;
  }

  /**
   * Groups reference their parent by code, so they are inserted parents-first:
   * sorting by code is enough, since a parent's code is always numerically lower
   * than its children's (10000 before 10100).
   */
  private async seedGroups(): Promise<number> {
    const existing = new Map(
      (
        await this.prisma.accountGroup.findMany({
          select: { id: true, code: true },
        })
      ).map((g) => [g.code, g.id]),
    );
    // The codes this database ALREADY held, frozen before anything is created.
    //
    // `existing` has to keep growing through the loop, because a child group
    // looks its parent's id up in it — but awaitingRecode must not see those
    // additions. Only a group that was here BEFORE the seed can be one a
    // revision is about to move; a group this very loop just created cannot be.
    //
    // Reading the growing map instead lost whole blocks on a fresh database:
    // the loop runs in ascending code order, so it created 22000, then reached
    // 25000, found the recode 22000 -> 25000 with 22000 now "present", and
    // skipped 25000 as a code still to be vacated. Same for 27000 -> 28000.
    // Employee Related Liabilities and Intercompany Payable were never created,
    // and the twenty-nine accounts under them were skipped after them.
    const before = new Set(existing.keys());
    let created = 0;
    for (const g of [...COA_GROUPS].sort((a, b) =>
      a.code.localeCompare(b.code),
    )) {
      if (existing.has(g.code)) continue;
      if (awaitingRecode(COA_RECODED_GROUPS, g.code, before)) continue;
      const parentId = g.parentCode
        ? (existing.get(g.parentCode) ?? null)
        : null;
      if (g.parentCode && parentId == null) {
        // Cannot happen with the shipped data (the converter checks it), but a
        // silent orphan would be worse than a loud skip.
        this.logger.warn(
          `Group ${g.code} skipped: parent ${g.parentCode} missing.`,
        );
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
          // Only a top-level group carries a schedule; a sub-group reports
          // under its parent's.
          mainGroup: g.parentCode ? null : (COA_MAIN_GROUPS[g.code] ?? null),
          sortOrder: g.sortOrder,
          isActive: g.isActive ?? true,
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
        await this.prisma.accountGroup.findMany({
          select: { id: true, code: true },
        })
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
      if (awaitingRecode(COA_RECODED_ACCOUNTS, a.code, existing)) continue;
      const groupId = groupIds.get(a.groupCode);
      if (groupId == null) {
        this.logger.warn(
          `Account ${a.code} skipped: group ${a.groupCode} missing.`,
        );
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
          isCash: a.isCash,
          isBank: a.isBank,
          isPdcIssued: a.isPdcIssued,
          isPdcReceived: a.isPdcReceived,
          isReconcilable: a.isReconcilable,
          isIntercompany: a.isIntercompany,
          eliminationPair: a.eliminationPair,
          allowManualJe: a.allowManualJe,
          // Everything the annexure ships is a system account: it is the signed
          // -off master, so it may be deactivated but never deleted.
          isSystem: true,
          notes: a.notes,
          sortOrder: a.sortOrder,
          isActive: a.isActive ?? true,
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
      (
        await this.prisma.account.findMany({ select: { id: true, code: true } })
      ).map((a) => [a.code, a.id]),
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
        await this.prisma.costCentreCategory.findMany({
          select: { code: true },
        })
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
