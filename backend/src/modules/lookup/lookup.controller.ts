import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LookupService } from './lookup.service';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateLookupDto,
  CreateLookupValueDto,
  UpdateLookupDto,
  UpdateLookupValueDto,
} from './lookup.dto';

@ApiTags('lookups')
@ApiBearerAuth()
@Controller('lookups')
export class LookupController {
  constructor(private readonly service: LookupService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLookupDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLookupDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a lookup (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/lookups'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(id, dto.locked);
  }

  @Get(':id/values')
  findValues(@Param('id', ParseIntPipe) id: number) {
    return this.service.findValues(id);
  }

  @Post(':id/values')
  createValue(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLookupValueDto,
  ) {
    return this.service.createValueForLookup(id, dto);
  }
}

@ApiTags('lookup-values')
@ApiBearerAuth()
@Controller('lookup-values')
export class LookupValueController {
  constructor(private readonly service: LookupService) {}

  @Post()
  create(@Body() dto: CreateLookupValueDto) {
    return this.service.createValue(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOneValue(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLookupValueDto,
  ) {
    return this.service.updateValue(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeValue(id);
  }

  // Lock / unlock a lookup value (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/lookups'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLockValue(id, dto.locked);
  }
}
