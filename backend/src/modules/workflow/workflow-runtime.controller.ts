import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { ActOnTaskDto, StartWorkflowDto } from './workflow.dto';

/**
 * Workflow runtime — start approvals, the approver inbox, and acting on tasks.
 * The acting user is the authenticated user (JWT).
 */
@ApiTags('workflow')
@ApiBearerAuth()
@Controller('workflow')
export class WorkflowRuntimeController {
  constructor(private readonly service: WorkflowRuntimeService) {}

  /** Start a workflow for a document (called by a module or for demo). */
  @Post('instances')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartWorkflowDto) {
    return this.service.start(user.id, dto);
  }

  /** The current user's pending approvals. */
  @Get('my-tasks')
  myTasks(@CurrentUser() user: AuthUser) {
    return this.service.myTasks(user.id);
  }

  /** Instance status + full timeline. */
  @Get('instances/:id')
  instance(@Param('id', ParseIntPipe) id: number) {
    return this.service.getInstance(id);
  }

  /**
   * Act on a pending task — the ENGINE's own view of it, and nothing else.
   *
   * Do not wire a screen to this. It advances the workflow and stops there,
   * because the engine cannot reach a business module; what approval MEANS is
   * the module's, and only the module's `act` knows it. Approving a voucher
   * through here completed the workflow while the voucher stayed a draft — an
   * entry approved by everybody, never posted, and past the point where it
   * could be submitted, withdrawn or posted by hand.
   *
   * A person approves from the document's own screen; the approvals inbox
   * takes them there. This stays for the engine's own use and for a caller
   * that owns no document.
   */
  @Post('tasks/:id/act')
  act(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActOnTaskDto,
  ) {
    return this.service.act(user.id, id, dto);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.service.notifications(user.id);
  }

  @Get('notifications/unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Post('notifications/:id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.markRead(user.id, id);
  }
}
