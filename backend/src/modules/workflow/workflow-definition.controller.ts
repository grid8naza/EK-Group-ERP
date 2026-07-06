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
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { CreateWorkflowDto, UpdateWorkflowDto } from './workflow.dto';

/**
 * Workflow Setup (Cpanel) — define, per document type, the ordered approval
 * chain. Company-scoped by the active company (X-Company-Id).
 */
@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowDefinitionController {
  constructor(private readonly service: WorkflowDefinitionService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('moduleId') moduleId?: string,
    @Query('objectId') objectId?: string,
    @Query('search') search?: string,
  ) {
    const toId = (v?: string) => {
      const n = Number(v);
      return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    return this.service.findAll(companyId, {
      moduleId: toId(moduleId),
      objectId: toId(objectId),
      search,
    });
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
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkflowDto,
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

  @UseGuards(LockPrivilegeGuard('/cpanel/workflows'))
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}
