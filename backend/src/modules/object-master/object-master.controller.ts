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
import { ObjectType } from '@prisma/client';
import { ObjectMasterService } from './object-master.service';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import {
  CreateObjectDto,
  CreateObjectRevisionDto,
  LockObjectDto,
  UpdateObjectDto,
} from './object-master.dto';

@ApiTags('objects')
@ApiBearerAuth()
@Controller('objects')
export class ObjectMasterController {
  constructor(private readonly service: ObjectMasterService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('moduleId') moduleId?: string,
    @Query('objectType') objectType?: ObjectType,
    @Query('isSystem') isSystem?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.service.findAll({
      search,
      moduleId: moduleId ? Number(moduleId) : undefined,
      objectType,
      includeSystem: user.isSuperAdmin,
      isSystem:
        isSystem === 'true' ? true : isSystem === 'false' ? false : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateObjectDto, @CurrentUser() user: AuthUser) {
    // Only super admins may classify an object as a system object.
    if (!user.isSuperAdmin) dto.isSystem = false;
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateObjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!user.isSuperAdmin) delete dto.isSystem;
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock an object (must be unlocked before edit or delete).
  // Super-admin only, matching every other cpanel master's lock endpoint.
  @UseGuards(LockPrivilegeGuard('/cpanel/objects'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockObjectDto,
  ) {
    return this.service.setLock(id, dto.locked);
  }

  @Get(':id/revisions')
  findRevisions(@Param('id', ParseIntPipe) id: number) {
    return this.service.findRevisions(id);
  }

  @Post(':id/revisions')
  createRevision(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateObjectRevisionDto,
  ) {
    return this.service.createRevision(id, dto);
  }
}
