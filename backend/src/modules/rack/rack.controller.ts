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
import { RackService } from './rack.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateRackDto, UpdateRackDto } from './rack.dto';

/** Rack Master (Inventory) — sub-locations (rack / shelf / bin) inside a store. */
@ApiTags('racks')
@ApiBearerAuth()
@Controller('racks')
export class RackController {
  constructor(private readonly service: RackService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('storeId') storeId?: string,
    @Query('search') search?: string,
    // `all` returns every rack across companies — for cross-company forms
    // (e.g. the Product master's per-branch default location pickers).
    @Query('all') all?: string,
  ) {
    const unscoped = all === 'true' || all === '1';
    return this.service.findAll(
      unscoped ? undefined : companyId,
      Number(storeId) || undefined,
      search,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateRackDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRackDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(LockPrivilegeGuard('/inventory/racks'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
