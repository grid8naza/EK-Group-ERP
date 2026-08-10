import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartyKind, PdcStatus, VoucherStatus } from '@prisma/client';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { VoucherService } from './voucher.service';
import {
  BankDateDto,
  ActVoucherDto,
  CancelVoucherDto,
  CreateVoucherDto,
  PdcMoveDto,
  UpdateVoucherDto,
} from './voucher.dto';

/**
 * Vouchers — hand-written entries into the general ledger.
 *
 * Everything is scoped to the active company (X-Company-Id) and, where the
 * company works in branches, stamped with the active branch (X-Branch-Id).
 */
@ApiTags('vouchers')
@ApiBearerAuth()
@Controller('vouchers')
export class VoucherController {
  constructor(private readonly service: VoucherService) {}

  /** The kinds a person may raise by hand. */
  @Get('types')
  types() {
    return this.service.types();
  }

  // ---- the post-dated cheque register -------------------------------------
  // Above the :id routes, or 'pdc' would be read as a voucher id.

  /** Cheques written and not yet gone. */
  @Get('pdc')
  pdc(
    @CompanyId() companyId: number | undefined,
    @Query('status') status?: PdcStatus,
    @Query('side') side?: string,
  ) {
    return this.service.listPdc(
      companyId,
      status,
      side ? side === 'RECEIVED' : undefined,
    );
  }

  /**
   * Move one on — banked, cleared, bounced, presented again, replaced, torn
   * up. One route, because which of those are open depends on where it is and
   * that rule belongs in one place.
   */
  @Patch('pdc/:id')
  movePdc(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PdcMoveDto,
  ) {
    return this.service.movePdc(user.id, companyId, id, dto);
  }

  // ---- bank reconciliation -------------------------------------------------

  /** One bank account: what the books say, what the bank says, and the gap. */
  @Get('bank-reconciliation')
  bankReconciliation(
    @CompanyId() companyId: number | undefined,
    @Query('accountId') accountId: string,
    @Query('asOn') asOn: string,
  ) {
    return this.service.bankReconciliation(companyId, Number(accountId), asOn);
  }

  /** Tell one line the day the bank saw it, or take that back. */
  @Patch('lines/:id/bank-date')
  setBankDate(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BankDateDto,
  ) {
    return this.service.setBankDate(companyId, id, dto.bankDate ?? null);
  }

  @Get()
  list(
    @CompanyId() companyId: number | undefined,
    @Query('typeId') typeId?: string,
    @Query('typeCode') typeCode?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Parsed by hand: ParseIntPipe rejects an absent optional query param.
    return this.service.list(companyId, {
      typeId: typeId ? Number(typeId) : undefined,
      typeCode: typeCode || undefined,
      status: (status as VoucherStatus) || undefined,
      from,
      to,
    });
  }

  /** A party's still-standing bills — what a settlement may be posted against. */
  @Get('bills')
  bills(
    @CompanyId() companyId: number | undefined,
    @Query('partyKind') partyKind: string,
    @Query('partyId') partyId: string,
  ) {
    return this.service.outstandingBills(
      companyId,
      partyKind as PartyKind,
      Number(partyId),
    );
  }

  /**
   * The number the next voucher of this kind would take. A preview for the
   * entry screen — the number is only settled when the voucher is saved.
   *
   * Declared before `:id` so the path is not read as a voucher id.
   */
  @Get('next-no')
  nextNumber(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('typeCode') typeCode: string,
  ) {
    return this.service.nextNumber(companyId, branchId, typeCode);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateVoucherDto,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.service.update(user.id, companyId, branchId, id, dto);
  }

  /** Write a draft to the books. */
  @Patch(':id/post')
  post(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.post(user.id, companyId, id);
  }

  /**
   * Who signs for this voucher, and where it has got to — what the form needs
   * to know whether to offer Post or Submit, and to draw the approval trail.
   */
  @Get(':id/workflow')
  workflowState(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.workflowState(user.id, companyId, id);
  }

  /** Send a draft for approval. Posts it where no workflow governs the kind. */
  @Patch(':id/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.submit(user.id, companyId, id);
  }

  /** Approve, forward, reject or cancel — the last approval posts it. */
  @Patch(':id/act')
  act(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActVoucherDto,
  ) {
    return this.service.act(user.id, companyId, id, dto);
  }

  @Patch(':id/cancel')
  cancel(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelVoucherDto,
  ) {
    return this.service.cancel(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(companyId, id);
  }
}
