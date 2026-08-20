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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { HrTeamService } from './hr-team.service';
import {
  CreateHrTeamDto,
  TransferTeamMembersDto,
  UpdateHrTeamDto,
} from './hr-team.dto';

/** Teams — who answers for whose attendance. */
@ApiTags('hr-teams')
@ApiBearerAuth()
@Controller('hr-teams')
export class HrTeamController {
  constructor(private readonly service: HrTeamService) {}

  /**
   * The company's teams. `branchId=all` reads every branch; absent falls back
   * to the branch in context, which is what a branch's own screens want.
   */
  @Get()
  findAll(
    @CompanyId() companyId?: number,
    @BranchId() activeBranchId?: number,
    @Query('branchId') branchFilter?: string,
  ) {
    const scope =
      branchFilter === undefined
        ? activeBranchId
        : branchFilter === 'all'
          ? undefined
          : Number(branchFilter) || undefined;
    return this.service.findAll(companyId, scope);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(@Body() dto: CreateHrTeamDto, @CompanyId() companyId?: number) {
    return this.service.create(companyId, dto);
  }

  /**
   * Move people between teams — declared BEFORE the :id routes, since Nest
   * matches in order and "transfer" would otherwise be read as an id.
   */
  @Post('transfer')
  transfer(
    @Body() dto: TransferTeamMembersDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.transfer(companyId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHrTeamDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.remove(companyId, id);
  }

  @UseGuards(LockPrivilegeGuard('/hr/teams'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}
