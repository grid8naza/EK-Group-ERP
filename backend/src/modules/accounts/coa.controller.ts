import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { CoaService } from './coa.service';
import {
  CreateAccountDto,
  CreateGroupDto,
  UpdateAccountDto,
  UpdateAdoptionDto,
  UpdateGroupDto,
  UpsertBankDetailsDto,
} from './coa.dto';

/**
 * Chart of Accounts — the account master from Annexure D.
 *
 * The master is group-level and shared by every company; the active company
 * (X-Company-Id) decides which accounts read as adopted.
 */
@ApiTags('chart-of-accounts')
@ApiBearerAuth()
@Controller('coa')
export class CoaController {
  constructor(private readonly service: CoaService) {}

  @Get('groups')
  groups() {
    return this.service.groups();
  }

  @Get('accounts')
  accounts(@CompanyId() companyId: number | undefined) {
    return this.service.accounts(companyId);
  }

  @Get('cost-centre-categories')
  costCentreCategories() {
    return this.service.costCentreCategories();
  }

  /**
   * What a line to this account must carry in the active company — the company
   * setup and the account's own rule resolved into one answer, so an entry
   * screen builds itself from this rather than working it out again.
   */
  @Get('accounts/:id/entry-rules')
  entryRules(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.entryRules(companyId, id);
  }

  /** The next free code in a group, so the form can propose one. */
  @Get('groups/:id/next-account-code')
  nextAccountCode(@Param('id', ParseIntPipe) id: number) {
    return this.service
      .nextAccountCode(id)
      .then((code) => ({ code }));
  }

  @Post('groups')
  createGroup(@Body() dto: CreateGroupDto) {
    return this.service.createGroup(dto);
  }

  @Patch('groups/:id')
  updateGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) {
    return this.service.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeGroup(id);
  }

  @Post('accounts')
  createAccount(
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateAccountDto,
  ) {
    return this.service.createAccount(companyId, dto);
  }

  @Patch('accounts/:id')
  updateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.service.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  removeAccount(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeAccount(id);
  }

  /**
   * The real bank account behind a ledger marked as a bank — for the ACTIVE
   * company, since the ledger is shared and the bank account is not.
   */
  @Get('accounts/:id/bank-details')
  bankDetails(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.bankDetails(companyId, id);
  }

  @Put('accounts/:id/bank-details')
  saveBankDetails(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertBankDetailsDto,
  ) {
    return this.service.saveBankDetails(companyId, id, dto);
  }

  @Delete('accounts/:id/bank-details')
  removeBankDetails(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.removeBankDetails(companyId, id);
  }

  @Patch('accounts/:id/adoption')
  setAdoption(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdoptionDto,
  ) {
    return this.service.setAdoption(companyId, id, dto);
  }
}
