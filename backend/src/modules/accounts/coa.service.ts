import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNature,
  BalanceSide,
  MainGroup,
  StatementType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIN_GROUPS_BY_NATURE } from './main-groups';
import {
  CompanyEntrySetup,
  resolveEntryRules,
} from '../../common/entry-rules';
import {
  CreateAccountDto,
  CreateGroupDto,
  UpdateAccountDto,
  UpdateAdoptionDto,
  UpdateGroupDto,
  UpsertBankDetailsDto,
} from './coa.dto';
import { CODE_FORMATS } from './bank-details';

/**
 * Which statement a balance lands in follows from its nature and nothing else.
 * The annexure enforces this as a database check on both groups and accounts;
 * deriving it here means it can never be set inconsistently in the first place.
 */
const statementOf = (nature: AccountNature): StatementType =>
  nature === 'INCOME' || nature === 'EXPENSE' ? 'PL' : 'BS';

/** The side a balance normally sits on, before any contra flips it. */
const defaultSideOf = (nature: AccountNature): BalanceSide =>
  nature === 'ASSET' || nature === 'EXPENSE' ? 'DR' : 'CR';

/**
 * What the entry screen asks for on a line to this account. A cost object is a
 * department INSIDE a division, so asking for one without the other is not a
 * position anyone can mean — asking for the object ticks the centre with it
 * rather than being rejected.
 */
const costFlags = (hasCostCenter?: boolean, hasCostObject?: boolean) => ({
  hasCostCenter: !!hasCostCenter || !!hasCostObject,
  hasCostObject: !!hasCostObject,
});

/**
 * Where the money actually sits — and, for a cheque not yet honoured, where it
 * waits.
 *
 * Four kinds, and an account is at most one of them. Cash is counted by
 * counting the notes; a bank balance is agreed against a statement; a
 * post-dated cheque we wrote is a promise standing as a liability until it is
 * presented, and one we were given is an asset until it clears. Each is a
 * different book, and a screen that wants one of them cannot be built out of a
 * flag that means several.
 */
const MONEY_KINDS = [
  ['isCash', 'holds cash'],
  ['isBank', 'sits at a bank'],
  ['isPdcIssued', 'holds post-dated cheques issued'],
  ['isPdcReceived', 'holds post-dated cheques received'],
] as const;

const moneyFlags = (dto: {
  isCash?: boolean;
  isBank?: boolean;
  isPdcIssued?: boolean;
  isPdcReceived?: boolean;
}) => {
  const claimed = MONEY_KINDS.filter(([key]) => dto[key]);
  if (claimed.length > 1) {
    throw new BadRequestException(
      `An account ${claimed.map(([, said]) => said).join(' or ')} — it cannot be more than one.`,
    );
  }
  return {
    isCash: !!dto.isCash,
    isBank: !!dto.isBank,
    isPdcIssued: !!dto.isPdcIssued,
    isPdcReceived: !!dto.isPdcReceived,
  };
};

/**
 * The Chart of Accounts as the application reads and maintains it.
 *
 * The 253 accounts and 44 groups shipped by Annexure D are the signed-off
 * baseline: they are seeded on boot, marked system, and may be renamed or
 * deactivated but never deleted, because consolidation depends on their codes
 * staying put. Anything added here is not system and can be removed again.
 *
 * A new account is either added to the shared group master, where any company
 * may adopt it, or kept private to one company — which is what the annexure's
 * `ownerCompanyId` is for, and why a private account is adopted by its owner the
 * moment it is created.
 */
@Injectable()
export class CoaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The group hierarchy, parents before children, each with what hangs off it —
   * the Groups screen has to say whether a heading is empty before anyone can
   * decide to delete it, and the server refuses a group that isn't.
   */
  async groups() {
    const rows = await this.prisma.accountGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { accounts: true, children: true } } },
    });
    return rows.map(({ _count, ...g }) => ({
      ...g,
      accountCount: _count.accounts,
      childCount: _count.children,
    }));
  }

  /**
   * Every account in the master, each carrying whether the ACTIVE company has
   * adopted it. Adoption is returned rather than filtered on, so the screen can
   * show the whole master and mark what this company uses — hiding the rest
   * would make it impossible to adopt anything new from the UI.
   */
  async accounts(companyId: number | undefined) {
    // Level 1 of the two checkpoints. What an account ASKS for is one thing;
    // what this company is set up to work in is another, and the screen has to
    // show the second, not the first — an account that asks for a cost centre
    // in a company that does not use them asks for nothing.
    const setup = companyId ? await this.companySetup(companyId) : null;
    const rows = await this.prisma.account.findMany({
      include: {
        group: { select: { id: true, code: true, name: true } },
        companies: companyId
          ? {
              where: { companyId },
              select: {
                id: true,
                localName: true,
                allowPosting: true,
                isActive: true,
              },
            }
          : false,
        // This company's own bank account behind the ledger, where it has one.
        // Carried on the list rather than fetched per account: it is a handful
        // of rows in 253, and the screen shows which bank a ledger is at.
        bankDetails: companyId ? { where: { companyId } } : false,
      },
      orderBy: [{ code: 'asc' }],
    });
    return rows.map(({ companies, bankDetails, ...a }) => {
      // A deactivated row is a dropped adoption, not an adoption.
      const mine = companies?.find((c) => c.isActive);
      const rules = setup ? resolveEntryRules(setup, a) : null;
      return {
        ...a,
        adopted: !!mine,
        adoptionId: mine?.id ?? null,
        localName: mine?.localName ?? null,
        allowPosting: mine?.allowPosting ?? null,
        adoptionActive: mine?.isActive ?? null,
        /** Both checkpoints together — what an entry here is actually asked for. */
        entryRules: rules,
        /** Null on anything that is not a bank, and on a bank not filled in yet. */
        bankDetail: bankDetails?.[0] ?? null,
      };
    });
  }

  /** Level 1: what this company works in at all. */
  private async companySetup(companyId: number): Promise<CompanyEntrySetup> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        branchApplicable: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * What a line to this account must carry in this company — the two
   * checkpoints resolved into one answer, for the entry screen to build itself
   * from and the posting engine to enforce.
   */
  async entryRules(companyId: number | undefined, accountId: number) {
    if (!companyId) throw new NotFoundException('Select a company first.');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, hasCostCenter: true, hasCostObject: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    const setup = await this.companySetup(companyId);
    return {
      accountId: account.id,
      company: setup,
      account: {
        hasCostCenter: account.hasCostCenter,
        hasCostObject: account.hasCostObject,
      },
      rules: resolveEntryRules(setup, account),
    };
  }

  costCentreCategories() {
    return this.prisma.costCentreCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * Adopt or drop an account for the active company, and set its local label.
   *
   * Dropping DEACTIVATES the row rather than deleting it, which matters for two
   * reasons. The seed is additive and re-creates anything missing, so a deleted
   * adoption would come back on the next boot and quietly undo the decision —
   * the row has to remain for the seeder to see it and leave it alone. And once
   * the ledger exists, an account that has been posted to must keep its adoption
   * on record even after the company stops using it.
   */
  async setAdoption(
    companyId: number | undefined,
    accountId: number,
    dto: UpdateAdoptionDto,
  ) {
    if (!companyId) {
      throw new NotFoundException('Select a company first.');
    }
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    if (dto.adopted === false) {
      await this.prisma.accountCompany.updateMany({
        where: { companyId, accountId },
        data: { isActive: false, allowPosting: false },
      });
      return { adopted: false };
    }

    await this.prisma.accountCompany.upsert({
      where: { companyId_accountId: { companyId, accountId } },
      create: {
        companyId,
        accountId,
        localName: dto.localName?.trim() || null,
        allowPosting: dto.allowPosting ?? true,
        isActive: dto.isActive ?? true,
      },
      update: {
        localName:
          dto.localName !== undefined ? dto.localName?.trim() || null : undefined,
        // Re-adopting revives a row that was dropped earlier, so both flags are
        // restored unless the caller says otherwise.
        allowPosting: dto.allowPosting ?? true,
        isActive: dto.isActive ?? true,
      },
    });
    return { adopted: true };
  }

  // ---- the bank behind a bank ledger ----------------------------------------

  /** This company's bank account behind a ledger, or null if none is recorded. */
  async bankDetails(companyId: number | undefined, accountId: number) {
    if (!companyId) throw new NotFoundException('Select a company first.');
    return this.prisma.bankAccountDetail.findUnique({
      where: { companyId_accountId: { companyId, accountId } },
    });
  }

  /**
   * Record — or correct — which bank account a ledger actually is, for the
   * ACTIVE company.
   *
   * Company-scoped throughout, because the ledger is shared and the bank account
   * is not: all three companies post to 14201 and each of them banks somewhere
   * different under it.
   *
   * Only on an account marked `isBank`. A cash box has no IFSC, and a ledger
   * that carried a number and then stopped being a bank would leave a routing
   * code on something no payment can be made from.
   */
  async saveBankDetails(
    companyId: number | undefined,
    accountId: number,
    dto: UpsertBankDetailsDto,
  ) {
    if (!companyId) throw new NotFoundException('Select a company first.');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, isBank: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.isBank) {
      throw new BadRequestException(
        `${account.code} ${account.name} is not marked as a bank account, so it has no bank to record.`,
      );
    }

    const data = {
      bankName: dto.bankName.trim(),
      branchName: dto.branchName?.trim() || null,
      branchAddress: dto.branchAddress?.trim() || null,
      accountNumber: dto.accountNumber.trim(),
      accountTypeValueId: dto.accountTypeValueId ?? null,
      accountHolderName: dto.accountHolderName?.trim() || null,
      ...this.checkedCodes(dto),
      currencyId: dto.currencyId ?? null,
      contactPerson: dto.contactPerson?.trim() || null,
      contactPhone: dto.contactPhone?.trim() || null,
      contactEmail: dto.contactEmail?.trim() || null,
      chequeOffsetX: dto.chequeOffsetX ?? 0,
      chequeOffsetY: dto.chequeOffsetY ?? 0,
      notes: dto.notes?.trim() || null,
    };

    return this.prisma.bankAccountDetail.upsert({
      where: { companyId_accountId: { companyId, accountId } },
      create: { companyId, accountId, ...data },
      update: data,
    });
  }

  /**
   * The routing codes, upper-cased and checked against their formats.
   *
   * Upper-cased rather than rejected for case: every one of these is written in
   * capitals and nobody means a different code by typing it in lower case.
   * Spaces go the same way — an IBAN is quoted in groups of four and is one
   * string.
   */
  private checkedCodes(dto: UpsertBankDetailsDto) {
    const out: Record<keyof typeof CODE_FORMATS, string | null> = {
      ifscCode: null,
      micrCode: null,
      swiftCode: null,
      iban: null,
    };
    for (const [field, { pattern, message }] of Object.entries(CODE_FORMATS) as [
      keyof typeof CODE_FORMATS,
      (typeof CODE_FORMATS)[keyof typeof CODE_FORMATS],
    ][]) {
      const raw = dto[field]?.replace(/[\s-]/g, '').toUpperCase() ?? '';
      if (!raw) continue;
      if (!pattern.test(raw)) throw new BadRequestException(message);
      out[field] = raw;
    }
    return out;
  }

  /**
   * Forget the bank behind a ledger — the account was closed, or the details
   * were entered against the wrong ledger. The ledger and everything posted to
   * it stay; only the description of where the money sits goes.
   */
  async removeBankDetails(companyId: number | undefined, accountId: number) {
    if (!companyId) throw new NotFoundException('Select a company first.');
    await this.prisma.bankAccountDetail.deleteMany({
      where: { companyId, accountId },
    });
    return { deleted: true };
  }

  // ---- codes ----------------------------------------------------------------
  //
  // The numbering convention (Annexure D.3) is not decoration: a five-digit code
  // in fixed blocks sorts naturally and groups without a lookup, which is what
  // lets the trial balance and the balance-sheet roll-up be a plain sort. So the
  // rules below are enforced rather than merely suggested. They were derived
  // from the shipped master and hold for all 44 groups and 253 accounts:
  //   · every group code ends in 00
  //   · a child group shares its parent's first two digits
  //   · an account shares its group's first THREE digits and never ends in 00

  /** The next unused account code in a group, or null if the hundred is full. */
  async nextAccountCode(groupId: number): Promise<string | null> {
    const group = await this.prisma.accountGroup.findUnique({
      where: { id: groupId },
      select: { code: true },
    });
    if (!group) throw new NotFoundException('Account group not found');
    const prefix = group.code.slice(0, 3);
    const taken = new Set(
      (
        await this.prisma.account.findMany({
          where: { code: { startsWith: prefix } },
          select: { code: true },
        })
      ).map((a) => a.code),
    );
    for (let n = 1; n <= 99; n++) {
      const code = `${prefix}${String(n).padStart(2, '0')}`;
      if (!taken.has(code)) return code;
    }
    return null;
  }

  private async assertAccountCode(code: string, groupCode: string) {
    if (!/^\d{5}$/.test(code)) {
      throw new BadRequestException('An account code is five digits.');
    }
    if (code.endsWith('00')) {
      throw new BadRequestException(
        'A code ending in 00 is a group heading, not an account.',
      );
    }
    if (code.slice(0, 3) !== groupCode.slice(0, 3)) {
      throw new BadRequestException(
        `An account in group ${groupCode} must be numbered ${groupCode.slice(0, 3)}01 to ${groupCode.slice(0, 3)}99.`,
      );
    }
    const clash = await this.prisma.account.findUnique({ where: { code } });
    if (clash) {
      throw new ConflictException(`Account code ${code} is already used.`);
    }
  }

  /**
   * Add an account to the master.
   *
   * Nature and statement are taken from the group and cannot be chosen: they
   * decide which statement the balance lands in, and every one of the 253
   * shipped accounts agrees with its group on both. The normal side defaults to
   * the group's but IS settable, because a contra account inside an ordinary
   * group flips it — Purchase Returns sits in Purchases yet carries a credit.
   */
  async createAccount(companyId: number | undefined, dto: CreateAccountDto) {
    const group = await this.prisma.accountGroup.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new NotFoundException('Account group not found');

    const code = dto.code?.trim() || (await this.nextAccountCode(dto.groupId));
    if (!code) {
      throw new BadRequestException(
        `Group ${group.code} has no free code left; every number in the hundred is used.`,
      );
    }
    await this.assertAccountCode(code, group.code);

    if (dto.isControl && !dto.controlParty) {
      throw new BadRequestException(
        'A control account is aged by a party, so it must say which kind.',
      );
    }

    // Private accounts belong to the company that raised them. Group-master
    // accounts belong to nobody and every company may adopt them.
    let ownerCompanyId: number | null = null;
    if (dto.scope === 'PRIVATE') {
      if (!companyId) {
        throw new BadRequestException(
          'Select a company before adding an account private to it.',
        );
      }
      ownerCompanyId = companyId;
    }

    const account = await this.prisma.account.create({
      data: {
        code,
        name: dto.name.trim(),
        groupId: group.id,
        nature: group.nature,
        statement: statementOf(group.nature),
        normalSide: dto.normalSide ?? group.normalSide,
        tallyGroup: group.tallyGroup,
        isContra: dto.isContra ?? false,
        isControl: dto.isControl ?? false,
        controlParty: dto.isControl ? dto.controlParty : null,
        ...costFlags(dto.hasCostCenter, dto.hasCostObject),
        isGstRelevant: dto.isGstRelevant ?? false,
        ...moneyFlags(dto),
        isReconcilable: dto.isReconcilable ?? false,
        allowManualJe: dto.allowManualJe ?? true,
        notes: dto.notes?.trim() || null,
        ownerCompanyId,
        // Not shipped by the annexure, so it may be deleted again.
        isSystem: false,
        sortOrder: 0,
      },
    });

    // A private account nobody has adopted could never be posted to, so the
    // company that raised it adopts it on the spot.
    if (ownerCompanyId) {
      await this.prisma.accountCompany.create({
        data: { companyId: ownerCompanyId, accountId: account.id },
      });
    }
    return account;
  }

  /**
   * Add a group heading. A root group starts a block of its own; a child shares
   * its parent's first two digits, as all eight shipped children do.
   */
  async createGroup(dto: CreateGroupDto) {
    const code = dto.code.trim();
    if (!/^\d{5}$/.test(code) || !code.endsWith('00')) {
      throw new BadRequestException(
        'A group code is five digits ending in 00 — that is what marks it a heading rather than a postable account.',
      );
    }
    if (await this.prisma.accountGroup.findUnique({ where: { code } })) {
      throw new ConflictException(`Group code ${code} is already used.`);
    }

    let nature = dto.nature;
    let parent: Awaited<
      ReturnType<PrismaService['accountGroup']['findUnique']>
    > = null;
    if (dto.parentGroupId) {
      parent = await this.prisma.accountGroup.findUnique({
        where: { id: dto.parentGroupId },
      });
      if (!parent) throw new NotFoundException('Parent group not found');
      if (code.slice(0, 2) !== parent.code.slice(0, 2)) {
        throw new BadRequestException(
          `A group under ${parent.code} must be numbered ${parent.code.slice(0, 2)}x00.`,
        );
      }
      // A child cannot change block: it would land in a different statement
      // from the parent it rolls up into.
      nature = parent.nature;
    }
    if (!nature) {
      throw new BadRequestException('Choose what the group holds.');
    }

    return this.prisma.accountGroup.create({
      data: {
        code,
        name: dto.name.trim(),
        parentGroupId: parent?.id ?? null,
        nature,
        statement: statementOf(nature),
        normalSide: dto.normalSide ?? parent?.normalSide ?? defaultSideOf(nature),
        // A sub-group reports under its parent's schedule, so it carries none
        // of its own however the form was filled in.
        mainGroup: parent ? null : this.checkedMainGroup(dto.mainGroup, nature),
        tallyGroup: dto.tallyGroup?.trim() || parent?.tallyGroup || null,
        isSystem: false,
        sortOrder: 0,
      },
    });
  }

  /**
   * A schedule has to belong to the side of the books its group is on — an
   * asset group reported under Current Liabilities would put a balance in the
   * wrong half of the balance sheet, and nothing downstream would notice.
   */
  private checkedMainGroup(
    mainGroup: MainGroup | undefined,
    nature: AccountNature,
  ): MainGroup | null {
    if (!mainGroup) return null;
    if (!MAIN_GROUPS_BY_NATURE[nature].includes(mainGroup)) {
      throw new BadRequestException(
        `A ${nature.toLowerCase()} group cannot report under ${mainGroup
          .toLowerCase()
          .replace(/_/g, ' ')}.`,
      );
    }
    return mainGroup;
  }

  /**
   * Rename a group, or take it out of use. Nothing else: see UpdateGroupDto.
   *
   * A heading is only out of use once everything filed under it is, so a group
   * cannot be deactivated while a live sub-group or account still hangs from
   * it — otherwise the chart would show a closed heading with open accounts
   * inside, and nothing downstream would know which to believe. The same rule
   * read the other way stops a group being reopened under a closed parent.
   */
  async updateGroup(id: number, dto: UpdateGroupDto) {
    const existing = await this.prisma.accountGroup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Account group not found');

    if (dto.isActive === false && existing.isActive) {
      await this.assertEmptyOfLive(existing.id, `${existing.code} ${existing.name}`);
    }
    if (dto.isActive === true && !existing.isActive && existing.parentGroupId) {
      const parent = await this.prisma.accountGroup.findUnique({
        where: { id: existing.parentGroupId },
        select: { code: true, name: true, isActive: true },
      });
      if (parent && !parent.isActive) {
        throw new BadRequestException(
          `${parent.code} ${parent.name} is inactive. Reopen it before reopening what sits under it.`,
        );
      }
    }

    return this.prisma.accountGroup.update({
      where: { id },
      data: { name: dto.name?.trim(), isActive: dto.isActive },
    });
  }

  /** Refuse to close a heading that still has anything live filed under it. */
  private async assertEmptyOfLive(groupId: number, label: string) {
    const [children, accounts] = await Promise.all([
      this.prisma.accountGroup.count({
        where: { parentGroupId: groupId, isActive: true },
      }),
      this.prisma.account.count({ where: { groupId, isActive: true } }),
    ]);
    if (children || accounts) {
      const held = [
        children ? `${children} active sub-group${children === 1 ? '' : 's'}` : null,
        accounts ? `${accounts} active account${accounts === 1 ? '' : 's'}` : null,
      ]
        .filter(Boolean)
        .join(' and ');
      throw new BadRequestException(
        `${label} still holds ${held}. Deactivate them first — a heading is only closed once everything under it is.`,
      );
    }
  }

  /**
   * Delete an account that was added here. Anything the annexure shipped is
   * system and is deactivated instead — the master is the signed-off baseline
   * and consolidation depends on its codes staying put.
   */
  async removeAccount(id: number) {
    const existing = await this.prisma.account.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Account not found');
    if (existing.isSystem) {
      throw new BadRequestException(
        `${existing.code} ${existing.name} is part of the Annexure D master. Deactivate it instead of deleting it.`,
      );
    }
    // Adoptions cascade; once the ledger exists this must also refuse an
    // account that has been posted to.
    await this.prisma.account.delete({ where: { id } });
    return { deleted: true };
  }

  async removeGroup(id: number) {
    const existing = await this.prisma.accountGroup.findUnique({
      where: { id },
      include: { _count: { select: { accounts: true, children: true } } },
    });
    if (!existing) throw new NotFoundException('Account group not found');
    if (existing.isSystem) {
      throw new BadRequestException(
        `${existing.code} ${existing.name} is part of the Annexure D master. Deactivate it instead of deleting it.`,
      );
    }
    if (existing._count.accounts || existing._count.children) {
      throw new BadRequestException(
        'Empty the group first — it still holds accounts or sub-groups.',
      );
    }
    await this.prisma.accountGroup.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * The few master fields the finance team may change. Code, group, nature and
   * side are structural — changing one would silently move an account between
   * statements — so they are not editable here.
   */
  /**
   * Rename an account, or take it out of use. Nothing else: see
   * UpdateAccountDto.
   *
   * An account may only be reopened while its group is open, which is the other
   * half of the rule that closes a heading only once everything under it is
   * closed.
   */
  async updateAccount(id: number, dto: UpdateAccountDto) {
    const existing = await this.prisma.account.findUnique({
      where: { id },
      include: { group: { select: { code: true, name: true, isActive: true } } },
    });
    if (!existing) throw new NotFoundException('Account not found');

    if (dto.isActive === true && !existing.isActive && !existing.group.isActive) {
      throw new BadRequestException(
        `${existing.group.code} ${existing.group.name} is inactive. Reopen the group before the accounts under it.`,
      );
    }

    return this.prisma.account.update({
      where: { id },
      data: { name: dto.name?.trim(), isActive: dto.isActive },
    });
  }
}
