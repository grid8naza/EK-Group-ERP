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
import { ModuleMasterService } from './module-master.service';
import { CreateModuleDto, UpdateModuleDto } from './module-master.dto';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { assertSuperAdmin } from '../../common/assert-super-admin';
import { LockDto } from '../../common/lock.dto';

@ApiTags('modules')
@ApiBearerAuth()
@Controller('modules')
export class ModuleMasterController {
  constructor(private readonly service: ModuleMasterService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateModuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a module (must be unlocked before edit or delete).
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSuperAdmin(user);
    return this.service.setLock(id, dto.locked);
  }
}
