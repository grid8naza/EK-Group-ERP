import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartyKind } from '@prisma/client';
import { CompanyId } from '../../auth/company.decorator';
import { PartyLedgerService } from './party-ledger.service';

/**
 * The party sub-ledger read back: statement of account and bill ageing.
 *
 * Query params are parsed by hand — ParseIntPipe rejects an absent optional
 * param, and every filter here is optional by design.
 */
@ApiTags('party-ledger')
@ApiBearerAuth()
@Controller('party-ledger')
export class PartyLedgerController {
  constructor(private readonly service: PartyLedgerService) {}

  /** Suppliers and customers, for the picker on both reports. */
  @Get('parties')
  parties(
    @CompanyId() companyId: number | undefined,
    @Query('partyKind') partyKind?: string,
  ) {
    return this.service.parties(
      companyId,
      partyKind ? (partyKind as PartyKind) : undefined,
    );
  }

  @Get('statement')
  statement(
    @CompanyId() companyId: number | undefined,
    @Query('partyKind') partyKind: string,
    @Query('partyId') partyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.statement(
      companyId,
      partyKind as PartyKind,
      Number(partyId),
      from || undefined,
      to || undefined,
    );
  }

  @Get('ageing')
  ageing(
    @CompanyId() companyId: number | undefined,
    @Query('partyKind') partyKind: string,
    @Query('asOn') asOn?: string,
    @Query('partyId') partyId?: string,
  ) {
    return this.service.ageing(
      companyId,
      partyKind as PartyKind,
      asOn || undefined,
      partyId ? Number(partyId) : undefined,
    );
  }
}
