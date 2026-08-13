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
import { TaskScope, TaskService } from './task.service';
import {
  ChecklistItemDto,
  CommentDto,
  CreateTaskDto,
  SetStatusDto,
  ToggleChecklistDto,
  UpdateTaskDto,
} from './task.dto';

/** "to-me" (assigned to me) or "by-me" (raised by me); anything else is to-me. */
const scopeOf = (raw?: string): TaskScope =>
  raw === 'by-me' ? 'by-me' : 'to-me';

/**
 * Task management (SRS §8.12).
 *
 * The company and branch a task belongs to come from X-Company-Id /
 * X-Branch-Id, never from the body: the board a branch works from is the
 * branch's, and a client naming its own branch could fill somebody else's.
 */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TaskController {
  constructor(private readonly service: TaskService) {}

  @Get('directory')
  directory(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.directory(user.id, q);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
    @Query('scope') scope?: string,
    @Query('q') q?: string,
    @Query('closed') closed?: string,
  ) {
    return this.service.list(user.id, scopeOf(scope), companyId, branchId, {
      q,
      includeClosed: closed === '1' || closed === 'true',
    });
  }

  /** Open work of this kind sitting in the caller's OTHER companies. */
  @Get('elsewhere')
  elsewhere(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId?: number,
    @Query('scope') scope?: string,
  ) {
    return this.service.elsewhere(user.id, scopeOf(scope), companyId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTaskDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  /** What the task says — the raiser's to change. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  /** How it is going — the assignee's to change, and the raiser's too. */
  @Post(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStatusDto,
  ) {
    return this.service.setStatus(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user.id, id);
  }

  // ------------------------------------------------------------- checklist --

  @Post(':id/checklist')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChecklistItemDto,
  ) {
    return this.service.addChecklistItem(user.id, id, dto);
  }

  @Post(':id/checklist/:itemId')
  toggleItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: ToggleChecklistDto,
  ) {
    return this.service.toggleChecklistItem(user.id, id, itemId, dto.isDone);
  }

  @Delete(':id/checklist/:itemId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.service.removeChecklistItem(user.id, id, itemId);
  }

  // -------------------------------------------------------------- comments --

  @Post(':id/comments')
  comment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentDto,
  ) {
    return this.service.comment(user.id, id, dto);
  }
}
