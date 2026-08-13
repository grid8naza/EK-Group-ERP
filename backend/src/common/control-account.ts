import { BadRequestException } from '@nestjs/common';
import { PartyKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The MAIN LEDGER a party master hangs from — the control account whose balance
 * its own is part of.
 *
 * A control account is only a total; the parties pointing at it are the detail
 * behind that total. Saying which one a supplier or customer belongs to is what
 * lets a voucher offer the right sub-ledger: name Trade Creditors on a line and
 * only the trade suppliers are offered, not every party in the company.
 *
 * Shared by the two party masters rather than written twice — they are the same
 * rule seen from opposite sides, and the day a third master arrives (employees,
 * once HR builds them) it is the same rule again.
 *
 * Mandatory: every sub-ledger belongs to exactly one main ledger. A party under
 * no control account is a balance that is part of no total, and no picker could
 * offer it without offering it everywhere.
 *
 * Returns the id to store, having checked it is a control account of the right
 * kind that THIS company may actually post to.
 */
export async function resolveControlAccount(
  prisma: PrismaService,
  companyId: number,
  accountId: number | null | undefined,
  kind: PartyKind,
): Promise<number> {
  if (accountId == null) {
    throw new BadRequestException(
      `Choose the main ledger this ${kind.toLowerCase()} is kept under — ` +
        `every ${kind.toLowerCase()} belongs to one control account.`,
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      isControl: true,
      controlParty: true,
      companies: {
        where: { companyId },
        select: { isActive: true },
      },
    },
  });
  if (!account)
    throw new BadRequestException('That main ledger does not exist.');

  const noun = kind.toLowerCase();
  // Everything below names the account, because "invalid main ledger" on a list
  // of two hundred sends someone back to the chart to work out which rule they
  // broke.
  if (!account.isControl) {
    throw new BadRequestException(
      `${account.code} ${account.name} is not a control account, so no ${noun} ` +
        `can be kept under it. Tick “Control — aged by a party” on it first.`,
    );
  }
  if (account.controlParty !== kind) {
    throw new BadRequestException(
      `${account.code} ${account.name} is aged by ` +
        `${account.controlParty?.toLowerCase() ?? 'no party'}, not by ${noun}.`,
    );
  }
  if (!account.isActive) {
    throw new BadRequestException(
      `${account.code} ${account.name} has been retired and takes no new entries.`,
    );
  }
  // Adoption is what makes the shared master usable per company: an account this
  // company has not adopted cannot be posted to, so a party pointed at it would
  // be unpostable from the day it was saved.
  if (!account.companies.length || account.companies[0].isActive === false) {
    throw new BadRequestException(
      `${account.code} ${account.name} is not in use by this company — adopt it ` +
        `on Account Ledgers first.`,
    );
  }
  return account.id;
}

/** What a party listing shows of its main ledger: enough to name it. */
export const CONTROL_ACCOUNT_SELECT = {
  select: { id: true, code: true, name: true },
} as const;
