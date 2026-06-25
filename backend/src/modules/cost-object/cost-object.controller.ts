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
import { CostObjectService } from './cost-object.service';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateCostObjectDto, UpdateCostObjectDto } from './cost-object.dto';

@ApiTags('cost-objects')
@ApiBearerAuth()
@Controller('cost-objects')
export class CostObjectController {
  constructor(private readonly service: CostObjectService) {}

  @Get()
  findAll(
    @Query('costCenterId') costCenterId?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.findAll(
      costCenterId ? Number(costCenterId) : undefined,
      companyId ? Number(companyId) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCostObjectDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCostObjectDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock (super-admin only), like every other master.
  @UseGuards(SuperAdminGuard)
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
