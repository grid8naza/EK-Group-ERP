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
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { LockDto } from '../../common/lock.dto';
import { ContractService } from './contract.service';
import { CreateContractDto, UpdateContractDto } from './contract.dto';

/**
 * Supply contracts with institutional customers.
 *
 * A contract is the AGREEMENT — what goes out, on which days, at what price,
 * until when. Each day's obligation is derived from it rather than entered, so
 * there is no "today's contract order" to raise: `GET /contracts/due` answers
 * what is owed on a date, and the Order Catalogue carries it into the day's
 * order.
 */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractController {
  constructor(private readonly service: ContractService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateContractDto,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('branchId') branchId?: string,
  ) {
    // Number(), not ParseIntPipe — an optional pipe 400s on an absent param.
    const branch = Number(branchId);
    return this.service.findAll(
      companyId,
      Number.isInteger(branch) && branch > 0 ? branch : undefined,
    );
  }

  /**
   * What the live contracts oblige this branch to hand over on `date`
   * (YYYY-MM-DD), per product. Read by the Order Catalogue.
   *
   * The branch comes from the X-Branch-Id header: a contract Kadathy supplies is
   * Kadathy's demand and nobody else's.
   */
  @Get('due')
  dueOn(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('date') date?: string,
  ) {
    const on = date?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    return this.service.dueOn(companyId ?? 0, branchId ?? null, on);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContractDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(companyId, id);
  }

  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}
