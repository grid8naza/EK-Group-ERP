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
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { LpoService } from './lpo.service';
import { ActLpoDto, CreateLpoDto, UpdateLpoDto } from './lpo.dto';

/**
 * Local Purchase Orders — raised by the active company/branch on an EXTERNAL
 * supplier as a DRAFT, then submitted into the buyer's own approval workflow.
 * Visibility, buttons and status all follow the workflow engine.
 *
 * Unlike the ICPO there is no second side: an external supplier has no login, so
 * this lists one direction only.
 */
@ApiTags('local-purchase-orders')
@ApiBearerAuth()
@Controller('local-purchase-orders')
export class LpoController {
  constructor(private readonly service: LpoService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateLpoDto,
  ) {
    return this.service.create(
      user.id,
      companyId ?? 0,
      branchId,
      dto,
      !!user.isSuperAdmin,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
  ) {
    return this.service.findAll(user.id, companyId ?? 0, !!user.isSuperAdmin);
  }

  /** Whether the current user may raise a new order (workflow-governed). */
  @Get('create-access')
  createAccess(@CurrentUser() user: AuthUser) {
    return this.service.createAccess(user.id, !!user.isSuperAdmin);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(user.id, id, !!user.isSuperAdmin);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLpoDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user.id, id, !!user.isSuperAdmin);
  }

  /** Submit a draft into the approval workflow (the creator's forward action). */
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.submit(user.id, id, !!user.isSuperAdmin);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  @Post(':id/act')
  act(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActLpoDto,
  ) {
    return this.service.act(user.id, id, dto);
  }
}
