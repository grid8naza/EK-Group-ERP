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
import { PartyKind, VoucherStatus } from '@prisma/client';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { VoucherService } from './voucher.service';
import {
  CancelVoucherDto,
  CreateVoucherDto,
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
