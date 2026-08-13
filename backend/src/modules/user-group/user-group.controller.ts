import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserGroupService } from './user-group.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateUserGroupDto,
  UpdatePrivilegesDto,
  UpdateUserGroupDto,
} from './user-group.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

// User groups and their privilege matrices are super-admin-only, matching the
// Cpanel navigation (this screen is only surfaced to super admins). Enforced
// server-side so a non-super-admin with a valid token can't grant themselves
// privileges by calling these endpoints directly.
@ApiTags('user-groups')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('user-groups')
export class UserGroupController {
  constructor(private readonly service: UserGroupService) {}

  @Get()
  findAll(
    @CompanyId() companyId?: number,
    @Query('moduleId') moduleId?: string,
    @Query('companyId') companyIdQuery?: string,
  ) {
    // An explicit ?companyId= overrides the active-company header. The Users
    // screen uses this to list groups for each company a user can access.
    const effective = companyIdQuery ? Number(companyIdQuery) : companyId;
    return this.service.findAll(
      requireCompany(effective),
      moduleId ? Number(moduleId) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserGroupDto, @CompanyId() companyId?: number) {
    return this.service.create(dto, requireCompany(companyId));
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserGroupDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a user group (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/user-groups'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }

  @Get(':id/privileges')
  getPrivileges(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPrivileges(id);
  }

  @Put(':id/privileges')
  updatePrivileges(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePrivilegesDto,
  ) {
    return this.service.updatePrivileges(id, dto);
  }
}
