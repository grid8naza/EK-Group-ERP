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
import { HsnService } from './hsn.service';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateHsnCodeDto, UpdateHsnCodeDto } from './hsn.dto';

/**
 * HSN Code Master (Inventory). HSN classification + GST rates are statutory and
 * the same for every company, so the endpoints are global (not company-scoped),
 * mirroring Unit / Currency.
 */
@ApiTags('hsn-codes')
@ApiBearerAuth()
@Controller('hsn-codes')
export class HsnController {
  constructor(private readonly service: HsnService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.service.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateHsnCodeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHsnCodeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(SuperAdminGuard)
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
