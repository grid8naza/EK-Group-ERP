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

  /**
   * Every schedule this person set up or is on, across every company — a
   * schedule is a standing arrangement its owner must be able to find, not a
   * board. See ChecklistService.list. No company header is read here.
   */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  /**
   * The register — one row per day it was expected, and what became of it.
   *
   * Declared before `:id/...` writes for clarity only; `days` is parsed with
   * Number(), not an optional ParseIntPipe, which 400s on an absent param.
   */
  @Get(':id/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('days') days?: string,
  ) {
    return this.service.history(user.id, id, Number(days) || 30);
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
