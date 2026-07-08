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
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { WorkflowStatusService } from './workflow-status.service';
import {
  CreateWorkflowStatusDto,
  UpdateWorkflowStatusDto,
} from './workflow-status.dto';

/**
 * Approval-status vocabulary. Reads are open to any authenticated user (the
 * step picker and the document listing need the icons); mutations are
 * super-admin-only.
 */
@ApiTags('workflow-statuses')
@ApiBearerAuth()
@Controller('workflow-statuses')
export class WorkflowStatusController {
  constructor(private readonly service: WorkflowStatusService) {}

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.service.findAll(activeOnly === 'true');
  }

  @UseGuards(SuperAdminGuard)
  @Post()
  create(@Body() dto: CreateWorkflowStatusDto) {
    return this.service.create(dto);
  }

  @UseGuards(SuperAdminGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkflowStatusDto,
  ) {
    return this.service.update(id, dto);
  }

  @UseGuards(SuperAdminGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
