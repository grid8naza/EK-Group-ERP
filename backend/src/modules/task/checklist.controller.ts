import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { ChecklistService } from './checklist.service';
import { SaveChecklistDto } from './checklist.dto';

/**
 * Recurring checklists (SRS §8.12, FR-TSK-02).
 *
 * The schedules only. What they raise is an ordinary task, read and ticked on
 * the task board through /tasks — there is no second API for a checklist that
 * is under way, because there is no second kind of thing.
 *
 * X-Company-Id / X-Branch-Id stamp where a new schedule belongs and scope the
 * list, exactly as they do for the board it feeds.
 */
@ApiTags('checklists')
@ApiBearerAuth()
@Controller('checklists')
export class ChecklistController {
  constructor(private readonly service: ChecklistService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.list(user.id, companyId, branchId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveChecklistDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveChecklistDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user.id, id);
  }

  /** Raise today's occurrence now, without waiting for its start time. */
  @Post(':id/raise-now')
  raiseNow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.raiseNow(user.id, id);
  }
}
